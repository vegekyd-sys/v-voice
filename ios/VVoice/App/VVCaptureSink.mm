#import "VVCaptureSink.h"
#include <atomic>
#include <cstring>

static_assert(ATOMIC_LLONG_LOCK_FREE == 2, "Capture cursors must be lock free");
static_assert(ATOMIC_BOOL_LOCK_FREE == 2, "Capture flags must be lock free");

@interface VVCaptureRing : NSObject {
@public
    float *samples;
    uint32_t capacity, channels;
    std::atomic<uint64_t> readFrame, writeFrame;
    std::atomic<bool> stopped, overflowed;
    dispatch_source_t signal;
}
@end
@implementation VVCaptureRing
- (void)dealloc { free(samples); }
@end

@interface VVCaptureSink () {
    VVCaptureRing *_ring;
    AVAudioPCMBuffer *_buffer;
    VVCaptureBufferHandler _handler;
    VVCaptureOverflowHandler _overflow;
    uint32_t _blockFrames;
}
@end
@implementation VVCaptureSink
- (instancetype)initWithFormat:(AVAudioFormat *)format
                       handler:(VVCaptureBufferHandler)handler
                      overflow:(VVCaptureOverflowHandler)overflow {
    if (!(self = [super init])) return nil;
    if (format.commonFormat != AVAudioPCMFormatFloat32 || format.interleaved ||
        !format.channelCount || format.channelCount > 8 || format.sampleRate <= 0) return nil;
    _blockFrames = (uint32_t)llround(format.sampleRate * .02);
    _buffer = [[AVAudioPCMBuffer alloc] initWithPCMFormat:format frameCapacity:_blockFrames];
    _handler = [handler copy]; _overflow = [overflow copy];
    VVCaptureRing *ring = [VVCaptureRing new]; _ring = ring;
    ring->capacity = MAX(_blockFrames * 64, 2048u); ring->channels = format.channelCount;
    ring->samples = (float *)calloc((size_t)ring->capacity * ring->channels, sizeof(float));
    if (!ring->samples || !_buffer) return nil;
    ring->readFrame.store(0); ring->writeFrame.store(0);
    ring->stopped.store(false); ring->overflowed.store(false);
    dispatch_queue_t queue = dispatch_queue_create("com.versa.vvoice.capture", dispatch_queue_attr_make_with_qos_class(DISPATCH_QUEUE_SERIAL, QOS_CLASS_USER_INTERACTIVE, 0));
    ring->signal = dispatch_source_create(DISPATCH_SOURCE_TYPE_DATA_ADD, 0, 0, queue);
    __weak VVCaptureSink *weakSelf = self;
    dispatch_source_set_event_handler(ring->signal, ^{ [weakSelf drain]; });
    dispatch_resume(ring->signal);
    _node = [[AVAudioSinkNode alloc] initWithReceiverBlock:^OSStatus(const AudioTimeStamp *time, AVAudioFrameCount frames, const AudioBufferList *input) {
        // No allocation, locks, Objective-C dispatch, or Swift on this thread.
        if (ring->stopped.load(std::memory_order_relaxed)) return noErr;
        uint64_t write = ring->writeFrame.load(std::memory_order_relaxed);
        uint64_t read = ring->readFrame.load(std::memory_order_acquire);
        if (input->mNumberBuffers != ring->channels || frames > ring->capacity - (write - read)) {
            ring->overflowed.store(true, std::memory_order_release);
            dispatch_source_merge_data(ring->signal, 1); return noErr;
        }
        uint32_t start = write % ring->capacity, first = MIN(frames, ring->capacity - start);
        for (uint32_t channel = 0; channel < ring->channels; channel++) {
            const AudioBuffer *source = &input->mBuffers[channel];
            if (!source->mData || source->mDataByteSize < frames * sizeof(float)) {
                ring->overflowed.store(true, std::memory_order_release);
                dispatch_source_merge_data(ring->signal, 1); return noErr;
            }
            float *target = ring->samples + (size_t)channel * ring->capacity;
            memcpy(target + start, source->mData, first * sizeof(float));
            if (first < frames) memcpy(target, (const float *)source->mData + first, (frames - first) * sizeof(float));
        }
        ring->writeFrame.store(write + frames, std::memory_order_release);
        dispatch_source_merge_data(ring->signal, 1);
        return noErr;
    }];
    return self;
}
- (void)drain {
    VVCaptureRing *ring = _ring;
    if (ring->stopped.load(std::memory_order_acquire)) return;
    if (ring->overflowed.load(std::memory_order_acquire)) {
        ring->stopped.store(true, std::memory_order_release); _overflow(); return;
    }
    uint64_t read = ring->readFrame.load(std::memory_order_relaxed);
    while (!ring->stopped.load(std::memory_order_acquire) && ring->writeFrame.load(std::memory_order_acquire) - read >= _blockFrames) {
        uint32_t start = read % ring->capacity, first = MIN(_blockFrames, ring->capacity - start);
        for (uint32_t channel = 0; channel < ring->channels; channel++) {
            float *source = ring->samples + (size_t)channel * ring->capacity;
            float *target = _buffer.floatChannelData[channel];
            memcpy(target, source + start, first * sizeof(float));
            if (first < _blockFrames) memcpy(target + first, source, (_blockFrames - first) * sizeof(float));
        }
        _buffer.frameLength = _blockFrames;
        read += _blockFrames; ring->readFrame.store(read, std::memory_order_release);
        @autoreleasepool { _handler(_buffer); }
    }
}
- (void)invalidate {
    if (!_ring) return;
    _ring->stopped.store(true, std::memory_order_release);
    if (_ring->signal) dispatch_source_cancel(_ring->signal);
}
- (void)dealloc { [self invalidate]; }
@end

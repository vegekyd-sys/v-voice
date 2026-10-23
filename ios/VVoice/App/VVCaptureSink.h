#import <AVFoundation/AVFoundation.h>

NS_ASSUME_NONNULL_BEGIN
typedef void (^VVCaptureBufferHandler)(AVAudioPCMBuffer *buffer) NS_SWIFT_SENDABLE;
typedef void (^VVCaptureOverflowHandler)(void) NS_SWIFT_SENDABLE;

/// Copies realtime input into a bounded, preallocated ring. Conversion and
/// Swift callbacks run on a serial worker, never on the audio render thread.
@interface VVCaptureSink : NSObject
@property(nonatomic, readonly) AVAudioSinkNode *node;
- (nullable instancetype)initWithFormat:(AVAudioFormat *)format
                               handler:(VVCaptureBufferHandler)handler
                              overflow:(VVCaptureOverflowHandler)overflow;
- (void)invalidate;
@end
NS_ASSUME_NONNULL_END

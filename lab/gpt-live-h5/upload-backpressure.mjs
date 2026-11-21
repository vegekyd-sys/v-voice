// What a phone does when its uplink stops draining (a stalled connection on a lossy route):
// above `shedBytes` waiting to be sent it drops new microphone frames, so what reaches the model
// stays current, and sends again once below `resumeBytes`; only an uplink that has not drained for
// `stallMS` ends the call. The web page uses these numbers directly; the iOS App receives them in
// the call's native runtime policy (`upload`), so they are changed here, once, for every client.
export const UPLOAD_BACKPRESSURE = Object.freeze({shedBytes: 96_000, resumeBytes: 24_000, stallMS: 30_000});

# Two-axis head

Use only the declared current-call capability. Units are degrees relative to calibrated device zero, not world orientation. StackChan has yaw and pitch; it has no roll axis. A request to physically tilt sideways cannot be completed as roll.

| Operation | Arguments | Meaning |
| --- | --- | --- |
| `robot.move` | `{"yaw":0,"pitch":30,"speed":250}` | Absolute target; yaw −60…60, pitch 8…65; optional speed 100…500 |
| `robot.gesture` | `{"gesture":"nod"}` or `{"gesture":"shake"}` | Bounded three-step movement around the current pose |
| `robot.cancel` | `{}` | Stop the current controlled action, or report idle |

The adapter and firmware enforce live calibration limits, one active movement, rate bounds, deadline, owner and cancellation. Never widen limits, calibrate, change torque settings, or chain repetitive movements to defeat a refusal. Local touch interaction takes priority.

Only `status:"ok"` with `result.status:"completed"`, `feedbackValid:true`, `reason:"hardware_feedback"`, and all steps reached establishes feedback-confirmed arrival. This is servo readback evidence; human observation is still required for candidate hardware acceptance. `unknown` is not a retry invitation. A stop receipt confirms that the stop handler ran; it is not a separate physical-stillness measurement.

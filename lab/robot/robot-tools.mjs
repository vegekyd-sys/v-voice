import {robotOperations} from './robot-device.mjs';
export const ROBOT_ACTION_TOOL={type:'function',name:'robot_action',
 description:'控制本通话这台机器人的两轴头部：move=指定yaw/pitch角度，nod=点头，shake=摇头，stop=停止当前动作。没有roll轴，不能真的侧向歪头。只有status=ok且result.status=completed、feedbackValid=true才表示反馈确认到位；running只是开始，unknown不能重复下发。用户说停止转头只停止电机，不挂电话、不取消其他任务。',
 parameters:{type:'object',properties:{action:{type:'string',enum:['move','nod','shake','stop']},yaw:{type:'integer',minimum:-60,maximum:60},pitch:{type:'integer',minimum:8,maximum:65},speed:{type:'integer',minimum:100,maximum:500}},required:['action'],additionalProperties:false}};
export function robotActionRequest(args){
 const {action,...params}=args;
 if(action==='move')return {operation:'robot.move',args:robotOperations['robot.move'].validateArguments(params)};
 if(Object.keys(params).length)throw Error('gesture_has_no_angles');
 if(['nod','shake'].includes(action))return {operation:'robot.gesture',args:{gesture:action}};
 if(action==='stop')return {operation:'robot.cancel',args:{}};
 throw Error('unsupported_robot_action');
}

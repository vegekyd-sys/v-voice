import test from 'node:test';
import {prepareRobotBackend} from './robot-candidate-setup.mjs';
test('private Candidate V discovers robot-use using its actual workspace loader',async()=>{
 const {skill}=await prepareRobotBackend();
 console.log(JSON.stringify({check:'robot_skill_discovery',found:true,eligible:skill.eligible,source:skill.source,actualModel:false,physicalDevice:false}));
});

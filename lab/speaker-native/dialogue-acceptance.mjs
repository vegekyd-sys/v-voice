// Assertions for the fixed synthetic father/child corpus, never routing rules.
export function dialogueAcceptance(events){
  const decisions=events.filter(e=>e.type==='speaker.decision'),last=decisions.at(-1),people=last?.participants??[];
  const father=people.find(p=>p.name==='天懿'&&p.role==='adult'),child=people.find(p=>['十二','12'].includes(p.name)&&p.role==='child');
  const childQuestion=decisions.find(e=>/月亮.*弯/.test(e.turn?.text??''));
  const side=decisions.find(e=>/杯子/.test(e.turn?.text??'')),both=decisions.find(e=>/分别.*建议/.test(e.turn?.text??''));
  const focus=decisions.find(e=>/接下来只/.test(e.turn?.text??'')),bystander=decisions.find(e=>/方法.*有意思/.test(e.turn?.text??''));
  const story=decisions.find(e=>/故事/.test(e.turn?.text??''));
  const onlyChild=e=>Boolean(child&&e?.shouldRespond&&e.addresseeIds?.length===1&&e.addresseeIds[0]===child.id&&e.turn?.speakerId===child.id);
  return {
    distinctNamedSpeakers:Boolean(father&&child&&father.id!==child.id&&people.length===2),
    childQuestionToChild:onlyChild(childQuestion),
    humanSideConversationQuiet:Boolean(side&&!side.shouldRespond),
    collectiveToBoth:Boolean(father&&child&&both?.shouldRespond&&both.addresseeIds?.length===2&&[father.id,child.id].every(id=>both.addresseeIds.includes(id))),
    exclusiveChild:Boolean(child&&focus?.mode==='exclusive'&&focus.targetId===child.id),
    fatherWithheld:Boolean(father&&bystander?.turn?.speakerId===father.id&&bystander.status==='withheld'&&bystander.modelCalled===false&&!bystander.shouldRespond),
    childStoryToChild:onlyChild(story),
  };
}

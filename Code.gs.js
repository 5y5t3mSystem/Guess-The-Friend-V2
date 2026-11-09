/**
 * Guess The Friend - Google Apps Script API
 * Storage: one authoritative JSON snapshot per lobby in Lobbies; normalized
 * Players/Answers/Votes/GameState tabs are maintained for inspectability.
 */
const QUESTION_BANK = [
  "What is the most embarrassing thing that has ever happened to you?",
  "What is the dumbest reason you’ve ever been late?",
  "What is the funniest thing you’ve ever done because of a dare?",
  "What is the most chaotic thing you’ve done with your friends?",
  "What is something you did that you hope your friends never find out about?",
  "What is the weirdest thing you’ve ever done when you were alone?",
  "What is the most embarrassing message you’ve accidentally sent?",
  "What is the funniest excuse you’ve ever made to avoid something?",
  "What is the most random thing you’ve ever cried over?",
  "What is the most delusional thing you’ve ever convinced yourself was true?",
  "What is the weirdest food combination you’ve ever tried?",
  "What is the most awkward interaction you’ve ever had with someone?",
  "What is one embarrassing habit you have?",
  "What is the dumbest decision you’ve ever made?",
  "What is the funniest misunderstanding you’ve ever experienced?",
  "What is the most ridiculous thing you’ve done because of a crush?",
  "What is something you believed as a child that turned out to be completely wrong?",
  "What is the funniest thing you’ve ever gotten in trouble for?",
  "What is your biggest ‘I should’ve just stayed home’ moment?",
  "If your life had a warning label, what would it say?"
];
function shuffleQuestions_(items) {
  const deck=items.slice();
  for(let i=deck.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[deck[i],deck[j]]=[deck[j],deck[i]];}
  return deck;
}
function nextQuestion_(s) {
  if(!Array.isArray(s.questionDeck)||!s.questionDeck.length||s.questionIndex>=s.questionDeck.length){
    s.questionDeck=shuffleQuestions_(QUESTION_BANK);s.questionIndex=0;
  }
  return s.questionDeck[s.questionIndex++];
}

const CFG = { MAX_PLAYERS:8, MIN_PLAYERS:3, CODE_LEN:6, POLL_MS:2000,
  RECONNECT_MS:30000, LOBBY_TTL_MS:30*60*1000, MAX_ANSWER:500, MAX_QUESTION:200,
  CHARACTERS:['red','yellow','blue','pink','green','orange','cyan','purple'],
  SHEETS:{Lobbies:['code','status','hostId','revision','updatedAt','expiresAt','stateJson'],
    Players:['lobbyCode','playerId','name','character','sessionHash','connected','lastSeen','ready'],
    GameState:['lobbyCode','revision','phase','round','phaseStartedAt','deadlineAt','stateJson'],
    Answers:['lobbyCode','round','answerId','authorId','answerText','submittedAt'],
    Votes:['lobbyCode','round','answerId','voterId','targetId','submittedAt'],
    Questions:['questionId','questionText','createdAt']} };

function doGet(e) {
  return json_({ok:true,service:'Guess The Friend API',version:1,
    actions:['createLobby','joinLobby','getLobbyState','selectCharacter','setReady','startGame',
      'submitAnswer','submitVote','advancePhase','leaveLobby','heartbeat','playAgain','closeLobby']});
}
function doPost(e) {
  let req;
  try { req=JSON.parse((e.postData&&e.postData.contents)||'{}'); }
  catch(err){ return json_({ok:false,error:{code:'BAD_JSON',message:'Invalid JSON request.'}}); }
  try { return json_(dispatch_(req)); }
  catch(err){ return json_({ok:false,error:{code:err.code||'SERVER_ERROR',message:err.message||'Request failed.'}}); }
}
function json_(obj){ return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function fail_(code,msg){ const e=new Error(msg);e.code=code;throw e; }
function now_(){return Date.now();}
function random_(n){const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let out='';for(let i=0;i<n;i++)out+=chars[Math.floor(Math.random()*chars.length)];return out;}
function token_(){return Utilities.getUuid().replace(/-/g,'')+Utilities.getUuid().replace(/-/g,'');}
function hash_(s){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,s).map(b=>(b+256).toString(16).slice(-2)).join('');}
function book_(){
  const id=PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if(!id) fail_('NOT_CONFIGURED','Run initializeDatabase() and configure the spreadsheet first.');
  return SpreadsheetApp.openById(id);
}
function initializeDatabase(){
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  if(!ss) throw new Error('Open the target spreadsheet, then run initializeDatabase().');
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID',ss.getId());
  Object.keys(CFG.SHEETS).forEach(n=>{
    let sh=ss.getSheetByName(n)||ss.insertSheet(n);
    const headers=CFG.SHEETS[n];
    if(sh.getLastRow()===0) sh.getRange(1,1,1,headers.length).setValues([headers]);
    else {
      const existing=sh.getRange(1,1,1,Math.max(sh.getLastColumn(),headers.length)).getValues()[0];
      if(headers.some((h,i)=>existing[i]!==h)) throw new Error('Unexpected headers in '+n+'. No existing data was changed.');
    }
    sh.setFrozenRows(1);
  });
  return 'Database initialized: '+ss.getUrl();
}
function dispatch_(r){
  const action=String(r.action||'');
  const mutating=['createLobby','joinLobby','selectCharacter','setReady','startGame','submitAnswer','submitVote','advancePhase','leaveLobby','heartbeat','playAgain','closeLobby'];
  if(mutating.indexOf(action)<0 && action!=='getLobbyState') fail_('UNKNOWN_ACTION','Unsupported action.');
  if(action==='createLobby') return createLobby_(r);
  if(action==='joinLobby') return joinLobby_(r);
  if(action==='getLobbyState') return getState_(r);
  return withLock_(()=>mutate_(action,r));
}
function withLock_(fn){const lock=LockService.getScriptLock();lock.waitLock(20000);try{return fn();}finally{lock.releaseLock();}}
function lobbySheet_(){return book_().getSheetByName('Lobbies');}
function loadLobby_(code){
  code=String(code||'').toUpperCase();
  const sh=lobbySheet_(), values=sh.getDataRange().getValues();
  for(let i=1;i<values.length;i++) if(values[i][0]===code) {
    const state=JSON.parse(values[i][6]||'{}'); state._row=i+1; return state;
  }
  fail_('LOBBY_NOT_FOUND','That lobby code does not exist.');
}
function saveLobby_(s){
  const sh=lobbySheet_(), row=s._row||sh.getLastRow()+1;
  s.revision=(s.revision||0)+1;s.updatedAt=now_();s.expiresAt=s.updatedAt+CFG.LOBBY_TTL_MS;
  sh.getRange(row,1,1,7).setValues([[s.code,s.status,s.hostId,s.revision,s.updatedAt,s.expiresAt,JSON.stringify(s)]]);
  s._row=row; // Lobbies.stateJson is authoritative; derived tabs are not rebuilt on every action.
}
function touchPlayer_(s,p){
  // Refresh the inactivity lease without incrementing the public game revision.
  // Keep the authoritative snapshot and indexed expiry columns in sync.
  s.updatedAt=now_();s.expiresAt=s.updatedAt+CFG.LOBBY_TTL_MS;
  lobbySheet_().getRange(s._row,5,1,3).setValues([[s.updatedAt,s.expiresAt,JSON.stringify(s)]]);
}
function syncSheets_(s){
  const ss=book_();
  const p=ss.getSheetByName('Players');
  // Rebuild only this lobby's rows in one batch, preserving all other lobbies.
  const old=p.getDataRange().getValues(), keep=[old[0]];
  for(let i=1;i<old.length;i++) if(old[i][0]!==s.code) keep.push(old[i]);
  const rows=s.players.map(x=>[s.code,x.id,x.name,x.character,x.sessionHash,x.connected,x.lastSeen,x.ready]);
  p.clearContents();p.getRange(1,1,keep.length,keep[0].length).setValues(keep);
  if(rows.length)p.getRange(p.getLastRow()+1,1,rows.length,8).setValues(rows);
  const gs=ss.getSheetByName('GameState'), gv=gs.getDataRange().getValues(), gkeep=[gv[0]];
  for(let i=1;i<gv.length;i++)if(gv[i][0]!==s.code)gkeep.push(gv[i]);
  gs.clearContents();gs.getRange(1,1,gkeep.length,gkeep[0].length).setValues(gkeep);
  gs.appendRow([s.code,s.revision,s.phase,s.round,s.phaseStartedAt||'',s.deadlineAt||'',JSON.stringify(publicState_(s,null,true))]);
  const a=ss.getSheetByName('Answers'), av=a.getDataRange().getValues(), ak=[av[0]];
  for(let i=1;i<av.length;i++)if(av[i][0]!==s.code)ak.push(av[i]);
  s.answers.forEach(x=>ak.push([s.code,s.round,x.id,x.authorId,x.text,x.at]));
  a.clearContents();a.getRange(1,1,ak.length,ak[0].length).setValues(ak);
  const v=ss.getSheetByName('Votes'), vv=v.getDataRange().getValues(), vk=[vv[0]];
  for(let i=1;i<vv.length;i++)if(vv[i][0]!==s.code)vk.push(vv[i]);
  s.votes.forEach(x=>vk.push([s.code,s.round,x.answerId,x.voterId,x.targetId,x.at]));
  v.clearContents();v.getRange(1,1,vk.length,vk[0].length).setValues(vk);
}
function createLobby_(r){
  return withLock_(()=>{
    const name=validName_(r.name), character=validCharacter_(r.character);
    const ss=book_();let code;
    do{code=random_(CFG.CODE_LEN);}while(findCode_(code));
    const id=Utilities.getUuid(), session=token_(), t=now_();
    const s={code,status:'waiting',hostId:id,revision:0,createdAt:t,updatedAt:t,expiresAt:t+CFG.LOBBY_TTL_MS,
      settings:normalizeSettings_(r),
      phase:'waiting',round:0,phaseStartedAt:null,deadlineAt:null,question:'',players:[{id,name,character,sessionHash:hash_(session),connected:true,lastSeen:t,ready:true,host:true,score:0}],
      answers:[],votes:[],answerCursor:0,voteCursor:0,currentAnswerId:null,requestIds:[]};
    saveLobby_(s);return {ok:true,code,playerId:id,sessionToken:session,revision:s.revision,state:publicState_(s,id,false)};
  });
}
function normalizeSettings_(r){
  const duration=Number(r.duration), rounds=Number(r.rounds);
  return {
    duration:Number.isFinite(duration)?Math.max(15,Math.min(180,Math.round(duration))):60,
    // Preserve an explicitly selected single round; only use defaults when omitted/invalid.
    rounds:Number.isFinite(rounds)?Math.max(1,Math.min(10,Math.round(rounds))):5
  };
}
function findCode_(code){const vals=lobbySheet_().getDataRange().getValues();return vals.some((r,i)=>i>0&&r[0]===code);}
function joinLobby_(r){
 return withLock_(()=>{
  const code=String(r.code||'').toUpperCase(), name=validName_(r.name), character=validCharacter_(r.character);
  const s=loadLobby_(code),t=now_();expireIfNeeded_(s,t);
  if(s.status!=='waiting')fail_('GAME_STARTED','This game has already started.');
  if(s.players.length>=CFG.MAX_PLAYERS)fail_('LOBBY_FULL','This lobby already has eight players.');
  if(s.players.some(p=>p.name.toLowerCase()===name.toLowerCase()))fail_('DUPLICATE_NAME','That player name is already in use.');
  if(s.players.some(p=>p.character===character))fail_('CHARACTER_TAKEN','That character is already reserved.');
  const id=Utilities.getUuid(),session=token_();
  s.players.push({id,name,character,sessionHash:hash_(session),connected:true,lastSeen:t,ready:false,host:false,score:0});
  saveLobby_(s);return {ok:true,code,playerId:id,sessionToken:session,revision:s.revision,state:publicState_(s,id,false)};
 });
}
function authenticate_(s,r){
 const p=s.players.find(x=>x.id===r.playerId);
 if(!p||!r.sessionToken||p.sessionHash!==hash_(String(r.sessionToken)))fail_('UNAUTHORIZED','Your player session is invalid or expired.');
 return p;
}
function mutate_(action,r){
 const s=loadLobby_(r.code),t=now_();expireIfNeeded_(s,t);
 const p=authenticate_(s,r), req=String(r.requestId||'');
 if(req&&s.requestIds.indexOf(req)>=0)return {ok:true,duplicate:true,revision:s.revision,state:publicState_(s,p.id,false)};
 if(req){s.requestIds.push(req);if(s.requestIds.length>100)s.requestIds.shift();}
 if(action==='heartbeat'){
  const beforeCount=s.players.length, beforeHost=s.hostId, beforePhase=s.phase, beforeVoter=s.currentVoterId, beforeDeadline=s.deadlineAt, beforeVoterIndex=s.voterIndex, wasConnected=p.connected;
  p.connected=true;p.lastSeen=t;releaseExpired_(s,t);
  // Recover phase transitions when a player disconnects and their grace period expires.
  if(s.status==='playing'&&s.phase==='voting'&&s.currentAnswerId){
   const answer=s.answers.find(a=>a.id===s.currentAnswerId&&a.round===s.round);
   if(answer){
    if(s.voterIndex>=s.voterOrder.length) finalizeAnswer_(s,t);
    else if(s.deadlineAt&&t>=s.deadlineAt) skipTimedOutVoter_(s,t);
   }
  }
  if(s.players.length!==beforeCount||s.hostId!==beforeHost||!wasConnected||s.phase!==beforePhase||s.currentVoterId!==beforeVoter||s.deadlineAt!==beforeDeadline||s.voterIndex!==beforeVoterIndex) saveLobby_(s);
  else touchPlayer_(s,p);
  return response_(s,p);
 }
 if(action==='leaveLobby'){p.connected=false;p.leftAt=t;p.lastSeen=t;releaseExpired_(s,t);if(p.host) migrateHost_(s);if(s.players.every(x=>!x.connected))s.status='closed';saveLobby_(s);return response_(s,p);}
 if(action==='selectCharacter'){
  if(s.status!=='waiting')fail_('GAME_STARTED','Characters cannot be changed after the game starts.');
  const ch=validCharacter_(r.character);
  if(s.players.some(x=>x.id!==p.id&&x.character===ch))fail_('CHARACTER_TAKEN','That character is already reserved.');
  p.character=ch;p.lastSeen=t;saveLobby_(s);return response_(s,p);
 }
 if(action==='setReady'){if(s.status!=='waiting')fail_('GAME_STARTED','Lobby is no longer waiting.');p.ready=!!r.ready;p.lastSeen=t;saveLobby_(s);return response_(s,p);}
 if(action==='startGame'){
  requireHost_(s,p);if(s.status!=='waiting')fail_('INVALID_PHASE','Game has already started.');
  if(s.players.length<CFG.MIN_PLAYERS)fail_('NOT_ENOUGH_PLAYERS','At least three players are required.');
  if(s.players.length>CFG.MAX_PLAYERS||new Set(s.players.map(x=>x.character)).size!==s.players.length)fail_('INVALID_ROSTER','Player or character reservations are inconsistent.');
  if(s.players.some(x=>!x.connected||!x.character))fail_('PLAYER_NOT_READY','All players must be connected and have a character.');
  s.status='playing';s.phase='answering';s.round=1;s.answers=[];s.votes=[];s.processedAnswerIds=[];s.answerCursor=0;s.questionDeck=shuffleQuestions_(QUESTION_BANK);s.questionIndex=0;s.question=nextQuestion_(s);s.phaseStartedAt=t;s.deadlineAt=null;saveLobby_(s);return response_(s,p);
 }
 if(action==='submitAnswer'){
  requirePhase_(s,'answering');const text=String(r.answer||'').trim();
  if(!text||text.length>CFG.MAX_ANSWER)fail_('INVALID_ANSWER','Answer must contain 1 to 500 characters.');
  if(s.answers.some(x=>x.authorId===p.id&&x.round===s.round))fail_('DUPLICATE_ANSWER','You have already submitted an answer this round.');
  s.answers.push({id:Utilities.getUuid(),authorId:p.id,authorName:p.name,authorCharacter:p.character,text,round:s.round,at:t});
  if(s.answers.filter(x=>x.round===s.round).length===s.players.length){const roundAnswers=s.answers.filter(x=>x.round===s.round);s.phase='voting';s.answerCursor=0;s.processedAnswerIds=[];s.currentAnswerId=roundAnswers[0].id;startVotingForAnswer_(s,roundAnswers[0],t);}
  saveLobby_(s);return response_(s,p);
 }
 if(action==='submitVote'){
  if(s.phase!=='voting')fail_('INVALID_PHASE','Voting is not active.');
  if(s.status!=='playing')fail_('INVALID_PHASE','This game is not accepting votes.');
  const answer=s.answers.find(x=>x.id===s.currentAnswerId&&x.id===r.answerId&&x.round===s.round);
  if(!answer)fail_('INVALID_ANSWER','That answer is not the currently active answer.');
  if(answer.authorId===p.id)fail_('ANSWER_AUTHOR_CANNOT_VOTE','You submitted this answer and cannot vote on it.');
  if(s.deadlineAt&&t>=s.deadlineAt){
   skipTimedOutVoter_(s,t);
   saveLobby_(s);
   fail_('VOTING_CLOSED','The voting deadline has expired; the turn has advanced.');
  }
  const eligible=eligibleVoters_(s,answer);
  if(eligible.indexOf(p.id)<0)fail_('VOTING_CLOSED','You are not eligible to vote on this answer.');
  if(s.currentVoterId!==p.id)fail_('NOT_YOUR_TURN','Please wait until it is your turn to vote.');
  const targetId=String(r.targetId||'');
  if(targetId===p.id)fail_('SELF_VOTE','You cannot vote for yourself.');
  if(!s.players.some(x=>x.id===targetId))fail_('INVALID_TARGET','Choose a player in this lobby.');
  if(s.votes.some(x=>x.answerId===answer.id&&x.voterId===p.id))fail_('DUPLICATE_VOTE','You have already voted on this answer.');
  s.votes.push({answerId:answer.id,voterId:p.id,targetId,round:s.round,at:t});
  s.voterIndex=(Number(s.voterIndex)||0)+1;
  if(s.voterIndex>=s.voterOrder.length)finalizeAnswer_(s,t);
  else activateCurrentVoter_(s,t);
  saveLobby_(s);return response_(s,p);
 }
 if(action==='advancePhase'){
  requireHost_(s,p);
  if(s.phase==='voting'){
   if(s.deadlineAt&&t<s.deadlineAt)fail_('PHASE_ACTIVE','The current player is still voting.');
   skipTimedOutVoter_(s,t);
  } else if(s.phase==='results'){
   advanceToNextAnswer_(s,t);
  } else fail_('INVALID_PHASE','Cannot advance this phase.');
  saveLobby_(s);return response_(s,p);
 }
 if(action==='playAgain'){
  requireHost_(s,p);if(s.phase!=='finished')fail_('INVALID_PHASE','The game is not finished.');
  s.players.forEach(x=>x.score=0);s.round=1;s.answers=[];s.votes=[];s.currentAnswerId=null;s.answerCursor=0;s.processedAnswerIds=[];s.questionDeck=shuffleQuestions_(QUESTION_BANK);s.questionIndex=0;s.question=nextQuestion_(s);s.phase='answering';s.status='playing';s.phaseStartedAt=t;s.deadlineAt=null;saveLobby_(s);return response_(s,p);
 }
 if(action==='closeLobby'){
  requireHost_(s,p);s.status='closed';s.players.forEach(x=>{x.connected=false;x.sessionHash='';});saveLobby_(s);return {ok:true,revision:s.revision,state:publicState_(s,p.id,false)};
 }
 fail_('UNKNOWN_ACTION','Unsupported action.');
}
function eligibleVoters_(s,answer){
 // Voting eligibility is snapshotted when this answer enters voting.
 // Connectivity is separate: temporary heartbeat failures must not rewrite
 // the turn order or disable an otherwise valid voter/target.
 return s.players.filter(x=>x.id!==answer.authorId).map(x=>x.id);
}
function startVotingForAnswer_(s,answer,t){
 s.voterOrder=eligibleVoters_(s,answer);
 s.voterIndex=0;
 s.phase='voting';s.phaseStartedAt=t;
 if(!s.voterOrder.length){finalizeAnswer_(s,t);return;}
 activateCurrentVoter_(s,t);
}
function activateCurrentVoter_(s,t){
 s.currentVoterId=(s.voterOrder||[])[s.voterIndex]||null;
 s.phaseStartedAt=t;
 s.deadlineAt=s.currentVoterId?t+s.settings.duration*1000:null;
}
function skipTimedOutVoter_(s,t){
 if(s.phase!=='voting')return;
 s.voterIndex=(Number(s.voterIndex)||0)+1;
 if(s.voterIndex>=(s.voterOrder||[]).length)finalizeAnswer_(s,t);
 else activateCurrentVoter_(s,t);
}
function finalizeAnswer_(s,t){
 const ans=s.answers.find(x=>x.id===s.currentAnswerId&&x.round===s.round);
 if(!ans||s.phase!=='voting')return;
 const votes=s.votes.filter(x=>x.answerId===ans.id);
 const correct=votes.filter(v=>v.targetId===ans.authorId);
 correct.forEach(v=>{const player=s.players.find(x=>x.id===v.voterId);if(player)player.score++;});
 const author=s.players.find(x=>x.id===ans.authorId);
 if(author)author.score=correct.length?Math.max(0,author.score-1):author.score+1;
 s.processedAnswerIds=s.processedAnswerIds||[];
 if(s.processedAnswerIds.indexOf(ans.id)<0)s.processedAnswerIds.push(ans.id);
 s.lastAnswerResult={answerId:ans.id,authorId:ans.authorId,authorName:author?author.name:(ans.authorName||'Unknown'),
   answerText:ans.text,votes:votes.map(v=>({voterId:v.voterId,targetId:v.targetId,
   voterName:(s.players.find(x=>x.id===v.voterId)||{}).name||'Player',
   targetName:(s.players.find(x=>x.id===v.targetId)||{}).name||'Player',
   correct:v.targetId===ans.authorId})),correctCount:correct.length};
 s.phase='results';s.phaseStartedAt=t;s.deadlineAt=null;s.currentVoterId=null;
}
function advanceToNextAnswer_(s,t){
 const pending=s.answers.filter(x=>x.round===s.round&&(s.processedAnswerIds||[]).indexOf(x.id)<0);
 if(pending.length){
  s.currentAnswerId=pending[0].id;s.lastAnswerResult=null;
  startVotingForAnswer_(s,pending[0],t);return;
 }
 if(s.round>=s.settings.rounds){s.phase='finished';s.status='finished';s.deadlineAt=null;s.currentAnswerId=null;s.currentVoterId=null;return;}
 s.round++;s.currentVoterId=null;s.voterOrder=[];s.voterIndex=0;s.answers=s.answers.filter(x=>x.round===s.round);s.votes=s.votes.filter(x=>x.round===s.round);
 s.question=nextQuestion_(s);s.currentAnswerId=null;s.processedAnswerIds=[];s.phase='answering';s.phaseStartedAt=t;s.deadlineAt=null;s.lastAnswerResult=null;
}
function getState_(r){
 const s=loadLobby_(r.code);const p=authenticate_(s,r);const t=now_();
 if(t-s.updatedAt>CFG.LOBBY_TTL_MS)fail_('LOBBY_EXPIRED','This lobby has expired.');
 p.lastSeen=t;p.connected=true;
 return {ok:true,revision:s.revision,state:publicState_(s,p.id,false)};
}
function response_(s,p){return {ok:true,revision:s.revision,state:publicState_(s,p.id,false)};}
function publicState_(s,viewerId,internal){
 const me=s.players.find(x=>x.id===viewerId), current=s.answers.find(a=>a.id===s.currentAnswerId);
 const reveal=s.phase==='results'||s.phase==='finished';
 return {code:s.code,status:s.status,revision:s.revision,serverNow:now_(),hostId:s.hostId,phase:s.phase,round:s.round,
  settings:s.settings,question:s.question,phaseStartedAt:s.phaseStartedAt,deadlineAt:s.deadlineAt,
  currentAnswerId:s.currentAnswerId,currentVoterId:s.currentVoterId||null,
  currentVoterName:(s.players.find(x=>x.id===s.currentVoterId)||{}).name||null,
  players:s.players.map(p=>({id:p.id,name:p.name,character:p.character,connected:p.connected,ready:p.ready,host:p.host,score:p.score})),
  answers:(reveal?s.answers.filter(a=>a.round===s.round):current?[current]:[]).map(a=>({id:a.id,authorId:a.authorId,text:a.text,round:a.round})),
  answerResult:reveal?(s.lastAnswerResult||null):null,
  myAnswerSubmitted:!!(me&&s.answers.some(a=>a.authorId===me.id&&a.round===s.round)),
  myVoteSubmitted:!!(me&&s.votes.some(v=>v.voterId===me.id&&v.answerId===s.currentAnswerId)),
  myVotingEligible:!!(me&&current&&me.id!==current.authorId),
  myIsAnswerAuthor:!!(me&&current&&me.id===current.authorId),
  myVotingTurn:!!(me&&current&&me.id!==current.authorId&&me.id===s.currentVoterId),
  voteCount:s.votes.filter(v=>v.answerId===s.currentAnswerId).length};
}
function validName_(v){const s=String(v||'').trim().replace(/\s+/g,' ');if(!s||s.length>16)fail_('INVALID_NAME','Name must contain 1 to 16 characters.');return s;}
function validCharacter_(v){v=String(v||'').toLowerCase();if(CFG.CHARACTERS.indexOf(v)<0)fail_('INVALID_CHARACTER','Choose a valid character.');return v;}
function validQuestion_(v){v=String(v||'').trim();if(!v||v.length>CFG.MAX_QUESTION)fail_('INVALID_QUESTION','Question must contain 1 to 200 characters.');return v;}
function requireHost_(s,p){if(!p.host||s.hostId!==p.id)fail_('HOST_ONLY','Only the host can perform this action.');}
function requirePhase_(s,phase){if(s.phase!==phase)fail_('INVALID_PHASE','This action is not allowed during the current phase.');if(s.deadlineAt&&now_()>s.deadlineAt)fail_('DEADLINE_PASSED','The phase deadline has passed.');}
function expireIfNeeded_(s,t){if(t-s.updatedAt>CFG.LOBBY_TTL_MS){s.status='expired';fail_('LOBBY_EXPIRED','This lobby has expired.');}releaseExpired_(s,t);}
function releaseExpired_(s,t){
 s.players.forEach(p=>{if(p.connected&&t-p.lastSeen>CFG.RECONNECT_MS){p.connected=false;p.disconnectedAt=p.lastSeen||t;}});
 s.players=s.players.filter(p=>p.connected||!p.disconnectedAt||t-p.disconnectedAt<=CFG.RECONNECT_MS);
 if(!s.players.some(p=>p.id===s.hostId)&&s.players.length)migrateHost_(s);
}
function migrateHost_(s){const n=s.players.filter(p=>p.connected).sort((a,b)=>b.lastSeen-a.lastSeen)[0];if(n){s.hostId=n.id;s.players.forEach(p=>p.host=p.id===n.id);}}
function cleanupExpiredLobbies(){
 withLock_(()=>{const sh=lobbySheet_(),v=sh.getDataRange().getValues(),now=now_();
  for(let i=1;i<v.length;i++){if(v[i][5]&&Number(v[i][5])<now&&v[i][1]!=='expired'){try{const s=JSON.parse(v[i][6]);s.status='expired';s.players=[];sh.getRange(i+1,2).setValue('expired');sh.getRange(i+1,7).setValue(JSON.stringify(s));}catch(e){}}}
 });
}

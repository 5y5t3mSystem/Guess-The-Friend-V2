/* Synchronized online multiplayer client. The server remains authoritative. */
(function(){
 'use strict';
 const $=id=>document.getElementById(id);
 const modal=$('modal-online'), entry=$('online-entry'), waiting=$('online-waiting'), game=$('online-game');
 let session=null, pollTimer=null, polling=false, pollFailures=0, serverOffsetMs=0, lastRevision=0, ready=false, busy=false, activeState=null, countdownTimer=null;
 const apiUrl=()=>window.GTF_CONFIG&&window.GTF_CONFIG.API_URL;
 const pollMs=()=>Math.max(1200,Number(window.GTF_CONFIG&&window.GTF_CONFIG.POLL_INTERVAL_MS)||2000);
 function message(text,error){const el=$('online-error');el.textContent=text||'';el.classList.toggle('is-error',!!error);}
 function gameMessage(text,error){const el=$('online-game-status');el.textContent=text||'';el.classList.toggle('is-error',!!error);}
 function requestId(){return window.crypto&&crypto.randomUUID?crypto.randomUUID():String(Date.now())+'-'+Math.random().toString(36).slice(2);}
 async function request(action,data){
  const url=apiUrl();
  if(!url||url.indexOf('https://script.google.com/macros/s/')!==0)throw new Error('Add your deployed Google Apps Script Web App URL in config.js first.');
  const payload=Object.assign({action,requestId:requestId()},session||{},data||{});
  const controller=window.AbortController?new AbortController():null;
  const timeout=controller?setTimeout(()=>controller.abort(),30000):null;
  try{
   const response=await fetch(url,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(payload),redirect:'follow',signal:controller?controller.signal:undefined,cache:'no-store'});
   if(!response.ok)throw new Error('Server returned HTTP '+response.status+'.');
   const result=await response.json();
   if(!result.ok)throw new Error(result.error&&result.error.message||'The request failed.');
   return result;
  }catch(e){if(e.name==='AbortError')throw new Error('The server took too long to respond. Please try again.');throw e;}
  finally{if(timeout)clearTimeout(timeout);}
 }
 function open(){modal.hidden=false;message('');if(session&&activeState){entry.hidden=true;render(activeState);schedulePoll(0);}else{entry.hidden=false;waiting.hidden=true;game.hidden=true;}}
 function stopPolling(){if(pollTimer)clearTimeout(pollTimer);pollTimer=null;}
 function stopCountdown(){if(countdownTimer)clearInterval(countdownTimer);countdownTimer=null;}
 function close(){modal.hidden=true;stopCountdown();}
 $('btn-create-game').addEventListener('click',open);
 $('online-close').addEventListener('click',close);
 $('online-create').addEventListener('click',async()=>{
  if(busy)return;busy=true;$('online-create').disabled=true;
  try{message('Creating lobby…');const settings=typeof window.GTF_GET_GAME_SETTINGS==='function'?window.GTF_GET_GAME_SETTINGS():{duration:60,rounds:5};const r=await request('createLobby',{name:$('online-name').value,character:$('online-character').value,duration:settings.duration,rounds:settings.rounds});session={code:r.code,playerId:r.playerId,sessionToken:r.sessionToken};enterWaiting(r.state);message('Lobby created. Share the code with your friends.');}
  catch(e){message(e.message,true);}finally{busy=false;$('online-create').disabled=false;}
 });
 $('online-join').addEventListener('click',async()=>{
  if(busy)return;busy=true;$('online-join').disabled=true;
  try{message('Joining lobby…');const r=await request('joinLobby',{code:$('online-code').value.trim().toUpperCase(),name:$('online-name').value,character:$('online-character').value});session={code:r.code,playerId:r.playerId,sessionToken:r.sessionToken};enterWaiting(r.state);message('You joined the lobby.');}
  catch(e){message(e.message,true);}finally{busy=false;$('online-join').disabled=false;}
 });
 function enterWaiting(state){entry.hidden=true;waiting.hidden=false;game.hidden=true;lastRevision=0;render(state);schedulePoll(0);}
 function render(state){
  if(!state||!session)return;activeState=state;if(Number.isFinite(Number(state.serverNow)))serverOffsetMs=Number(state.serverNow)-Date.now();lastRevision=Math.max(lastRevision,Number(state.revision)||0);
  if(state.status==='playing'||state.status==='finished'){
   waiting.hidden=true;game.hidden=false;renderGame(state);
  }else if(state.status==='waiting'){
   game.hidden=true;waiting.hidden=false;renderWaiting(state);
  }else{gameMessage('This lobby is no longer active.',true);}
 }
 function renderPlayers(state){
  const list=$('online-players');list.textContent='';
  state.players.forEach(p=>{
   const row=document.createElement('div');row.className='online-player';
   const img=document.createElement('img');img.src='assets/characters/char-'+p.character+'.png';img.alt='';
   const name=document.createElement('span');name.textContent=p.name+(p.host?' · HOST':'');
   const status=document.createElement('small');status.textContent=p.connected?'CONNECTED':'RECONNECTING';
   row.append(img,name,status);list.appendChild(row);
  });
 }
 function renderWaiting(s){
  $('online-lobby-code').textContent=s.code;
  const me=s.players.find(p=>p.id===session.playerId), host=s.hostId===session.playerId;
  $('online-start').hidden=!host;$('online-ready').hidden=host;
  ready=!!(me&&me.ready);$('online-ready').textContent=ready?'READY ✓':'SET READY';
  $('online-start').disabled=s.players.length<3||s.players.some(p=>!p.connected);
  $('online-status').textContent='Waiting for players · '+s.players.length+'/'+(window.GTF_CONFIG.MAX_PLAYERS||8)+' · Minimum 3 to start';
  renderPlayers(s);
 }
 function renderGame(s){
  const me=s.players.find(p=>p.id===session.playerId), host=s.hostId===session.playerId;
  $('online-round').textContent='ROUND '+s.round+' / '+(s.settings&&s.settings.rounds||5);
  $('online-question').textContent=s.question||'Answer the question below.';
  $('online-advance').hidden=!(host&&(s.phase==='results'||(s.phase==='voting'&&s.deadlineAt&&Date.now()>=s.deadlineAt)));
  $('online-advance').textContent=s.phase==='results'?'NEXT ANSWER':'CONTINUE';
  $('online-play-again').hidden=!(host&&s.phase==='finished');
  $('online-finished').hidden=s.phase!=='finished';
  $('online-answer-form').hidden=true;$('online-wait-answer').hidden=true;$('online-answer-card').hidden=true;
  $('online-vote-form').hidden=true;$('online-wait-vote').hidden=true;$('online-answer-results').hidden=true;
  $('online-game-title').textContent=s.phase==='answering'?'EVERYONE ANSWERS':s.phase==='voting'?'WHO WROTE THIS?':s.phase==='results'?'ANSWER REVEAL':'GAME COMPLETE';
  $('online-phase').textContent=s.phase==='answering'?'SECRET ANSWER':s.phase==='voting'?'GUESS & VOTE':s.phase==='results'?'VOTE RESULTS':'FINAL RESULTS';
  if(s.phase!=='voting')stopCountdown();
  if(s.phase==='answering'){
   if(s.myAnswerSubmitted){$('online-wait-answer').hidden=false;gameMessage('Your answer is submitted. Waiting for everyone else…');}
   else{$('online-answer-form').hidden=false;gameMessage('Submit your answer to continue.');}
  }else if(s.phase==='voting'){
   const answer=(s.answers||[])[0];
   if(answer){$('online-answer-card').hidden=false;$('online-answer-card').textContent=answer.text||'Answer unavailable';}
   const isAuthor=s.myIsAnswerAuthor===true;
   const isMyTurn=s.myVotingTurn===true && !s.myVoteSubmitted;
   if(isAuthor){
    stopCountdown();$('online-wait-vote').hidden=false;
    $('online-wait-vote').className='online-wait is-author-wait';
    $('online-wait-vote').textContent="That's your answer, don't get caught!";
    gameMessage("That's your answer, don't get caught!");
   }else if(!isMyTurn){
    stopCountdown();$('online-wait-vote').hidden=false;
    $('online-wait-vote').className='online-wait is-turn-wait';
    const activeVoter=s.currentVoterName||'the current player';
    $('online-wait-vote').textContent='Waiting for '+activeVoter+' to finish voting…';
    gameMessage('Waiting for '+activeVoter+' to finish voting. Your timer has not started.');
   }else{
    $('online-wait-vote').className='online-wait';
    renderVoteChoices(s);$('online-vote-form').hidden=false;updateDeadline(s);
   }
  }else if(s.phase==='results'){
   const panel=$('online-answer-results');panel.hidden=false;
   const result=s.answerResult||{};
   const lines=[`Answer: ${result.answerText||((s.answers||[])[0]||{}).text||'—'}`,`Written by: ${result.authorName||'Unknown'}`,`Correct guesses: ${result.correctCount||0}`];
   (result.votes||[]).forEach(v=>lines.push(`${v.voterName} → ${v.targetName} ${v.correct?'✓ Correct':'✕'}`));
   panel.textContent=lines.join('\n');panel.style.whiteSpace='pre-line';
   $('online-advance').hidden=!host;gameMessage(host?'Answer revealed. Continue when everyone is ready.':'Answer revealed. Waiting for the host to continue.');
  }else if(s.phase==='finished'){
   gameMessage('All rounds are complete.');renderScoreboard(s);
  }
 }
 function renderVoteChoices(s){
  const wrap=$('online-vote-players');wrap.textContent='';
  const me=session&&session.playerId;
  s.players.filter(p=>p.id!==me).forEach(p=>{
   const btn=document.createElement('button');btn.type='button';btn.className='online-vote-player';
   const img=document.createElement('img');img.src='assets/characters/char-'+p.character+'.png';img.alt='';
   const label=document.createElement('span');label.textContent=p.name;
   btn.append(img,label);btn.disabled=busy;
   btn.setAttribute('aria-label','Vote for '+p.name);
   btn.setAttribute('data-vote-target',String(p.id));
   btn.style.webkitTapHighlightColor='transparent';
   let activationLock=false;
   const submitVote=async()=>{
    if(activationLock||busy||p.id===me)return;
    activationLock=true;
    busy=true;
    Array.from(wrap.querySelectorAll('button')).forEach(b=>b.disabled=true);
    btn.classList.add('is-selected');
    try{
     const answer=(activeState.answers||[])[0];
     if(!answer)throw new Error('The active answer is unavailable.');
     const r=await request('submitVote',{answerId:answer.id,targetId:p.id});
     render(r.state);
    }catch(e){
     gameMessage(e.message,true);
     schedulePoll(0);
     Array.from(wrap.querySelectorAll('button')).forEach(b=>b.disabled=false);
    }finally{
     busy=false;
     activationLock=false;
     if(activeState&&activeState.phase==='voting'&&activeState.myVotingTurn===true&&!activeState.myVoteSubmitted){
      Array.from(wrap.querySelectorAll('button')).forEach(b=>b.disabled=false);
     }
    }
   };
   // Use pointerup for touchscreens. Native click can be unreliable when the
   // modal is scrolled on some mobile browsers; keyboard activation remains supported.
   btn.addEventListener('pointerup',e=>{
    if(e.pointerType==='touch'||e.pointerType==='pen'||e.pointerType==='mouse'){
     e.preventDefault();
     submitVote();
    }
   });
   btn.addEventListener('keydown',e=>{
    if(e.key==='Enter'||e.key===' '){e.preventDefault();submitVote();}
   });
   wrap.appendChild(btn);
  });
 }
 function renderScoreboard(s){
  const wrap=$('online-scoreboard');wrap.textContent='';
  const ranked=s.players.slice().sort((a,b)=>b.score-a.score);
  let previousScore=null,rank=0;
  ranked.forEach((p,i)=>{
   if(previousScore===null||p.score!==previousScore)rank=i+1;
   previousScore=p.score;
   const row=document.createElement('div');row.className='online-score-row'+(rank===1?' is-winner':'');
   const place=document.createElement('strong');place.textContent=rank===1?'🏆 #1':'#'+rank;
   const img=document.createElement('img');img.src='assets/characters/char-'+p.character+'.png';img.alt=p.character+' character';img.className='online-score-avatar';
   const name=document.createElement('span');name.textContent=p.name;
   const score=document.createElement('b');score.textContent=p.score+' pts';
   row.append(place,img,name,score);wrap.appendChild(row);
  });
 }
 function updateDeadline(s){
  stopCountdown();if(modal.hidden||document.hidden||s.phase!=='voting'||s.myVotingTurn!==true||s.myVoteSubmitted||!s.deadlineAt)return;
  const tick=()=>{const left=Math.max(0,Math.ceil((s.deadlineAt-(Date.now()+serverOffsetMs))/1000));gameMessage('Voting closes in '+left+'s · '+(s.voteCount||0)+' vote(s) received');$('online-advance').hidden=!(s.hostId===session.playerId&&left===0);};
  tick();countdownTimer=setInterval(tick,1000);
 }
 function schedulePoll(delay){stopPolling();pollTimer=setTimeout(poll,delay);}
 async function poll(){
  if(!session||polling)return;polling=true;
  try{
   // One heartbeat request supplies the latest state and refreshes the reconnect lease.
   const r=await request('heartbeat');
   if(r.state&&Number.isFinite(Number(r.state.serverNow)))serverOffsetMs=Number(r.state.serverNow)-Date.now();
   pollFailures=0;
   if(r.revision>lastRevision||!activeState)render(r.state);
   schedulePoll(document.hidden?10000:pollMs());
  }catch(e){
   pollFailures=Math.min(pollFailures+1,5);
   gameMessage('Reconnecting… '+e.message,true);
   schedulePoll(Math.min(30000,2000*Math.pow(2,pollFailures-1)));
  }
  finally{polling=false;}
 }
 $('online-ready').addEventListener('click',async()=>{if(busy)return;try{const r=await request('setReady',{ready:!ready});ready=!ready;render(r.state);}catch(e){message(e.message,true);}});
 $('online-start').addEventListener('click',async()=>{
  if(busy)return;busy=true;$('online-start').disabled=true;$('online-start').textContent='STARTING…';
  try{const r=await request('startGame',{question:'What is something your friends might not know about you?'});render(r.state);}
  catch(e){message(e.message,true);if(activeState&&activeState.status==='waiting')renderWaiting(activeState);}
  finally{$('online-start').textContent='START GAME';busy=false;if(activeState&&activeState.status==='waiting')$('online-start').disabled=activeState.players.length<3||activeState.players.some(p=>!p.connected);}
 });
 $('online-submit-answer').addEventListener('click',async()=>{
  if(busy)return;const value=$('online-answer').value.trim();if(!value){gameMessage('Please type an answer first.',true);return;}
  busy=true;$('online-submit-answer').disabled=true;
  try{const r=await request('submitAnswer',{answer:value});$('online-answer').value='';render(r.state);}
  catch(e){gameMessage(e.message,true);}
  finally{busy=false;$('online-submit-answer').disabled=false;}
 });
 $('online-advance').addEventListener('click',async()=>{if(busy)return;busy=true;try{const r=await request('advancePhase');render(r.state);}catch(e){gameMessage(e.message,true);}finally{busy=false;}});
 $('online-play-again').addEventListener('click',async()=>{if(busy)return;busy=true;try{const r=await request('playAgain');render(r.state);}catch(e){gameMessage(e.message,true);}finally{busy=false;}});
 $('online-copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('online-lobby-code').textContent);message('Lobby code copied.');}catch(e){message('Copy unavailable. Select the code to copy it.');}});
 async function leave(){stopPolling();stopCountdown();try{await request('leaveLobby');}catch(e){}session=null;activeState=null;pollFailures=0;close();entry.hidden=false;waiting.hidden=true;game.hidden=true;}
 $('online-leave').addEventListener('click',leave);$('online-game-leave').addEventListener('click',leave);
 document.addEventListener('visibilitychange',()=>{if(document.hidden)stopCountdown();else if(session){schedulePoll(0);if(!modal.hidden&&activeState&&activeState.phase==='voting')updateDeadline(activeState);}});
 window.addEventListener('beforeunload',()=>{stopPolling();stopCountdown();});
})();

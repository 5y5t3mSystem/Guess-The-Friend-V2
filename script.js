(function(){
  "use strict";

  var CHARACTERS = ['red','yellow','blue','pink','green','orange','cyan','purple'];
  var PRESET_QUESTIONS = [
    "What is the most embarrassing thing that has ever happened to you?",
    "What is the dumbest reason you\u2019ve ever been late?",
    "What is the funniest thing you\u2019ve ever done because of a dare?",
    "What is the most chaotic thing you\u2019ve done with your friends?",
    "What is something you did that you hope your friends never find out about?",
    "What is the weirdest thing you\u2019ve ever done when you were alone?",
    "What is the most embarrassing message you\u2019ve accidentally sent?",
    "What is the funniest excuse you\u2019ve ever made to avoid something?",
    "What is the most random thing you\u2019ve ever cried over?",
    "What is the most delusional thing you\u2019ve ever convinced yourself was true?",
    "What is the weirdest food combination you\u2019ve ever tried?",
    "What is the most awkward interaction you\u2019ve ever had with someone?",
    "What is one embarrassing habit you have?",
    "What is the dumbest decision you\u2019ve ever made?",
    "What is the funniest misunderstanding you\u2019ve ever experienced?",
    "What is the most ridiculous thing you\u2019ve done because of a crush?",
    "What is something you believed as a child that turned out to be completely wrong?",
    "What is the funniest thing you\u2019ve ever gotten in trouble for?",
    "What is your biggest \u201cI should\u2019ve just stayed home\u201d moment?",
    "If your life had a warning label, what would it say?"
  ];

  var MAX_DURATION = 180, MIN_DURATION = 15, DURATION_STEP = 15;
  var MAX_ROUNDS = 10, MIN_ROUNDS = 1;
  var VOTE_TIME = 60;

  var state = null;

  // Share the host's current settings with the online lobby creator.
  // Return a copy so multiplayer.js cannot mutate the local game settings.
  window.GTF_GET_GAME_SETTINGS = function(){
    var settings = state && state.settings ? state.settings : { duration: 60, rounds: 5 };
    return { duration: settings.duration, rounds: settings.rounds };
  };

  function $(id){ return document.getElementById(id); }
  function qsa(sel, root){ return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function qs(sel, root){ return (root || document).querySelector(sel); }
  function shuffle(arr){
    var a = arr.slice();
    for(var i=a.length-1;i>0;i--){
      var j = Math.floor(Math.random()*(i+1));
      var t=a[i]; a[i]=a[j]; a[j]=t;
    }
    return a;
  }
  function charImg(character){ return 'assets/characters/char-' + character + '.png'; }

  function freshState(){
    return {
      settings: { duration: 60, rounds: 5 },
      playerCount: 4,
      players: [],
      customQuestions: [],
      unusedPreset: [],
      usedQuestions: [],
      round: 0,
      currentQuestion: '',
      answers: {},
      answerOrder: [],
      answerIndex: 0,
      selectedAuthorId: null,
      voterOrder: [],
      voterIndex: 0,
      votes: {},
      selectedVoteTarget: null,
      guessTimerId: null,
      guessTimeLeft: 0,
      voteTimerId: null,
      voteTimeLeft: 0,
      charSelectTargetIndex: null
    };
  }


  /* ---------- AUDIO LIFECYCLE ---------- */
  // One phase-music instance at a time; sound effects use independent instances.
  var AudioController = (function(){
    var tracks = {
      intro: 'assets/audio/game-intro.mp3',
      gameplay: 'assets/audio/during-gameplay.mp3',
      voting: 'assets/audio/for-the-timer.mp3',
      winners: 'assets/audio/winners-bg.mp3'
    };
    var music = null;
    var currentKey = null;
    var generation = 0;
    var fadeFrame = null;
    var winnerRevealPlayed = false;

    function safePlay(audio){
      try {
        var promise = audio.play();
        if(promise && typeof promise.catch === 'function'){
          promise.catch(function(){ /* Autoplay may be blocked; later user gestures retry. */ });
        }
      } catch(err) { /* Audio must never block game flow. */ }
    }
    function cancelFade(){
      if(fadeFrame !== null){
        cancelAnimationFrame(fadeFrame);
        fadeFrame = null;
      }
    }
    function stopMusic(){
      generation++;
      cancelFade();
      if(music){
        music.onended = null;
        music.pause();
        try { music.currentTime = 0; } catch(err) {}
        music = null;
      }
      currentKey = null;
    }
    function fadeIn(audio, token, duration){
      var start = performance.now();
      audio.volume = 0;
      function step(now){
        if(token !== generation || music !== audio) return;
        var progress = Math.min(1,(now-start)/duration);
        audio.volume = progress;
        if(progress < 1) fadeFrame = requestAnimationFrame(step);
        else fadeFrame = null;
      }
      fadeFrame = requestAnimationFrame(step);
    }
    function playMusic(key, shouldFade){
      if(currentKey === key && music) {
        if(music.paused) safePlay(music);
        return;
      }
      stopMusic();
      if(!key || !tracks[key]) return;
      var token = generation;
      var audio = new Audio(tracks[key]);
      audio.loop = true;
      audio.preload = 'auto';
      audio.volume = shouldFade ? 0 : 0.72;
      music = audio;
      currentKey = key;
      safePlay(audio);
      if(shouldFade) fadeIn(audio, token, 1100);
    }
    function effect(path, options){
      options = options || {};
      var audio = new Audio(path);
      audio.preload = 'auto';
      audio.volume = options.volume == null ? 0.9 : options.volume;
      if(typeof options.onEnded === 'function') audio.addEventListener('ended', options.onEnded, {once:true});
      audio.addEventListener('error', function(){
        if(typeof options.onError === 'function') options.onError();
      }, {once:true});
      try {
        var promise = audio.play();
        if(promise && typeof promise.catch === 'function'){
          promise.catch(function(){
            if(typeof options.onError === 'function') options.onError();
          });
        }
      } catch(err) {
        if(typeof options.onError === 'function') options.onError();
      }
      return audio;
    }
    function phaseForScreen(id){
      if(id === 'screen-home' || id === 'screen-count') return 'intro';
      if(id === 'screen-question' || id === 'screen-answering' || id === 'screen-guessing') return 'gameplay';
      if(id === 'screen-voting') return 'voting';
      if(id === 'screen-leaderboard') return 'winners';
      return null;
    }
    function screenChanged(id){
      if(id !== 'screen-leaderboard') winnerRevealPlayed = false;
      var phase = phaseForScreen(id);
      if(phase === 'winners'){
        playWinnerReveal();
      } else {
        playMusic(phase, false);
      }
    }
    function playWinnerReveal(){
      if(winnerRevealPlayed) return;
      winnerRevealPlayed = true;
      stopMusic();
      var fallbackStarted = false;
      function startWinnerMusic(){
        if(fallbackStarted) return;
        fallbackStarted = true;
        if(document.getElementById('screen-leaderboard') &&
           !document.getElementById('screen-leaderboard').hidden){
          playMusic('winners', true);
        }
      }
      effect('assets/audio/when-showing-winners.mp3', {
        onEnded: startWinnerMusic,
        onError: startWinnerMusic
      });
    }
    function playVoteEffect(){
      effect('assets/audio/when-voting.mp3');
    }
    function unlock(){
      if(music && music.paused) safePlay(music);
    }
    return {
      screenChanged: screenChanged,
      playVoteEffect: playVoteEffect,
      unlock: unlock
    };
  })();

  document.addEventListener('pointerdown', function(){ AudioController.unlock(); }, {passive:true});
  document.addEventListener('keydown', function(){ AudioController.unlock(); });

  function showScreen(id){
    qsa('[data-screen]').forEach(function(screen){ screen.hidden = screen.id !== id; });
    if(id !== 'screen-voting') pauseVoteTimer();
    else resumeVoteTimer();
    AudioController.screenChanged(id);
    window.scrollTo(0,0);
  }
  function openModal(id){ $(id).hidden = false; }
  function closeModal(id){ $(id).hidden = true; }

  /* ---------- HOME / SETTINGS ---------- */

  function renderSettings(){
    $('duration-value').textContent = state.settings.duration + 's';
    $('rounds-value').textContent = state.settings.rounds;
  }

  $('btn-game-settings').addEventListener('click', function(){ renderSettings(); openModal('modal-settings'); });
  $('btn-how-to-play').addEventListener('click', function(){ openModal('modal-howtoplay'); });
  $('btn-save-settings').addEventListener('click', function(){ closeModal('modal-settings'); });
  $('duration-minus').addEventListener('click', function(){
    state.settings.duration = Math.max(MIN_DURATION, state.settings.duration - DURATION_STEP);
    renderSettings();
  });
  $('duration-plus').addEventListener('click', function(){
    state.settings.duration = Math.min(MAX_DURATION, state.settings.duration + DURATION_STEP);
    renderSettings();
  });
  $('rounds-minus').addEventListener('click', function(){
    state.settings.rounds = Math.max(MIN_ROUNDS, state.settings.rounds - 1);
    renderSettings();
  });
  $('rounds-plus').addEventListener('click', function(){
    state.settings.rounds = Math.min(MAX_ROUNDS, state.settings.rounds + 1);
    renderSettings();
  });

  qsa('[data-close]').forEach(function(btn){
    btn.addEventListener('click', function(){ closeModal(btn.dataset.close); });
  });

  $('btn-create-game').addEventListener('click', function(){
    if(window.GTF_CONFIG) return; // Online lobby is opened by multiplayer.js.
    showScreen('screen-count');
  });
  var localButton = $('btn-local-game');
  if(localButton) localButton.addEventListener('click', function(){ showScreen('screen-count'); });

  /* ---------- PLAYER COUNT ---------- */

  function renderCount(){ $('count-value').textContent = state.playerCount; }

  $('count-minus').addEventListener('click', function(){
    if(state.playerCount > 3){ state.playerCount--; renderCount(); }
  });
  $('count-plus').addEventListener('click', function(){
    if(state.playerCount < 8){ state.playerCount++; renderCount(); }
  });
  $('btn-continue-count').addEventListener('click', function(){
    buildPlayers();
    buildNameInputs();
    showScreen('screen-names');
  });

  qsa('[data-back]').forEach(function(btn){
    btn.addEventListener('click', function(){ showScreen(btn.dataset.back); });
  });

  /* ---------- PLAYER NAMES + CHARACTERS ---------- */

  function buildPlayers(){
    state.players = [];
    for(var i=0;i<state.playerCount;i++){
      state.players.push({ id:i, name:'', character:null, score:0 });
    }
  }

  function normalizeName(value){ return value.trim().replace(/\s+/g,' '); }

  function clearValidation(){
    var box = $('names-validation');
    box.textContent = '';
    box.classList.remove('show');
    qsa('.field-error', $('name-inputs')).forEach(function(el){ el.classList.remove('field-error'); });
  }
  function showNameError(message){
    var box = $('names-validation');
    box.textContent = message;
    box.classList.add('show');
  }

  function buildNameInputs(){
    var wrap = $('name-inputs');
    wrap.innerHTML = '';
    state.players.forEach(function(player, i){
      var field = document.createElement('div');
      field.className = 'name-field';
      field.innerHTML =
        '<button type="button" class="name-field-icon char-pick-btn" data-player="' + i + '" aria-label="Choose character for Player ' + (i+1) + '"></button>' +
        '<input class="name-input" type="text" maxlength="16" autocomplete="off" placeholder="Player ' + (i+1) + '">';
      wrap.appendChild(field);
    });
    refreshCharButtons();

    qsa('.char-pick-btn', wrap).forEach(function(btn){
      btn.addEventListener('click', function(){
        openCharacterModal(parseInt(btn.dataset.player, 10));
      });
    });
  }

  function refreshCharButtons(){
    qsa('.char-pick-btn').forEach(function(btn){
      var idx = parseInt(btn.dataset.player, 10);
      var p = state.players[idx];
      if(p.character){
        btn.innerHTML = '<img src="' + charImg(p.character) + '" alt="">';
        btn.classList.add('has-char');
      } else {
        btn.innerHTML = '?';
        btn.classList.remove('has-char');
      }
    });
  }

  function takenCharacters(excludeIndex){
    var taken = {};
    state.players.forEach(function(p, i){
      if(i !== excludeIndex && p.character) taken[p.character] = true;
    });
    return taken;
  }

  function openCharacterModal(playerIndex){
    state.charSelectTargetIndex = playerIndex;
    var taken = takenCharacters(playerIndex);
    var grid = $('character-grid');
    grid.innerHTML = '';
    CHARACTERS.forEach(function(ch){
      var cell = document.createElement('div');
      var isTaken = !!taken[ch];
      var isSelected = state.players[playerIndex].character === ch;
      cell.className = 'player-cell' + (isSelected ? ' selected' : '') + (isTaken ? ' char-taken' : '');
      cell.innerHTML =
        '<div class="player-avatar-wrap"><div class="player-avatar"><img src="' + charImg(ch) + '" alt="' + ch + '"></div></div>' +
        '<div class="player-name">' + (isTaken && !isSelected ? 'Taken' : ch.charAt(0).toUpperCase()+ch.slice(1)) + '</div>';
      if(!isTaken || isSelected){
        cell.addEventListener('click', function(){
          state.players[playerIndex].character = ch;
          refreshCharButtons();
          closeModal('modal-characters');
        });
      }
      grid.appendChild(cell);
    });
    openModal('modal-characters');
  }

  $('btn-continue-names').addEventListener('click', function(){
    var inputs = qsa('.name-input', $('name-inputs'));
    var names = inputs.map(function(input){ return normalizeName(input.value); });
    var seen = {};
    var valid = true;
    clearValidation();

    inputs.forEach(function(input, index){
      var name = names[index];
      var key = name.toLocaleLowerCase();
      if(!name || name.length > 16 || seen[key]){
        input.classList.add('field-error');
        valid = false;
      } else {
        seen[key] = input;
      }
    });

    var missingChar = state.players.some(function(p){ return !p.character; });
    if(missingChar){
      showNameError('Please choose a character for every player.');
      return;
    }

    if(!valid){
      showNameError('Please enter a unique name for every player.');
      var firstError = qs('.field-error', $('name-inputs'));
      if(firstError) firstError.focus();
      return;
    }

    state.players.forEach(function(p, i){ p.name = names[i]; p.score = 0; });
    startGame();
  });

  /* ---------- GAME START / QUESTIONS ---------- */

  function startGame(){
    state.round = 0;
    state.usedQuestions = [];
    state.unusedPreset = shuffle(PRESET_QUESTIONS);
    nextRound();
  }

  function pickQuestion(){
    if(state.customQuestions.length > 0){
      return state.customQuestions.shift();
    }
    if(state.unusedPreset.length === 0){
      // Reuse the preset bank only after every preset has been used this game.
      state.unusedPreset = shuffle(PRESET_QUESTIONS.filter(function(q){ return state.usedQuestions.indexOf(q) === -1; }));
      if(state.unusedPreset.length === 0){
        state.usedQuestions = [];
        state.unusedPreset = shuffle(PRESET_QUESTIONS);
      }
    }
    return state.unusedPreset.shift();
  }

  function nextRound(){
    stopGuessTimer();
    stopVoteTimer();
    state.round++;
    state.currentQuestion = pickQuestion();
    state.usedQuestions.push(state.currentQuestion);
    state.answers = {};
    state.answerOrder = shuffle(state.players.map(function(p){ return p.id; }));
    state.answerIndex = 0;
    state.selectedAuthorId = null;
    state.voterOrder = [];
    state.voterIndex = 0;
    state.votes = {};
    renderQuestionScreen();
  }

  function renderQuestionScreen(){
    $('round-count').textContent = 'Round ' + state.round + ' / ' + state.settings.rounds;
    $('question-text').textContent = state.currentQuestion;
    showScreen('screen-question');
  }

  $('btn-answer-question').addEventListener('click', function(){
    startAnswering();
  });

  $('btn-add-question').addEventListener('click', function(){
    $('custom-question-input').value = '';
    updateCustomQuestionCount();
    openModal('modal-add-question');
  });

  function updateCustomQuestionCount(){
    $('custom-question-count').textContent = state.customQuestions.length + ' / 10 custom questions';
    $('btn-save-question').disabled = state.customQuestions.length >= 10;
  }

  $('btn-save-question').addEventListener('click', function(){
    if(state.customQuestions.length >= 10) return;
    var text = $('custom-question-input').value.trim();
    if(!text) return;
    state.customQuestions.push(text);
    updateCustomQuestionCount();
    $('custom-question-input').value = '';
  });

  /* ---------- ANSWERING ---------- */

  function startAnswering(){
    showScreen('screen-answering');
    renderAnsweringTurn();
  }

  function currentAnswerPlayer(){
    var id = state.answerOrder[state.answerIndex];
    return state.players.filter(function(p){ return p.id === id; })[0];
  }

  function renderAnsweringTurn(){
    var player = currentAnswerPlayer();
    $('answering-question-text').textContent = state.currentQuestion;
    $('answering-avatar').innerHTML = '<img src="' + charImg(player.character) + '" alt="">';
    $('answering-turn-text').textContent = "It's " + player.name + "'s Turn";
    $('answer-input').value = '';
    $('answer-char-count').textContent = '0 characters';
    updateAnswerProgress();
  }

  function updateAnswerProgress(){
    var answered = Object.keys(state.answers).length;
    var total = state.players.length;
    $('answer-progress-fill').style.width = Math.round((answered/total)*100) + '%';
    $('answer-progress-count').textContent = answered + ' / ' + total + ' Players Answered';
  }

  $('answer-input').addEventListener('input', function(){
    $('answer-char-count').textContent = $('answer-input').value.length + ' characters';
  });

  $('btn-submit-answer').addEventListener('click', function(){
    var text = $('answer-input').value.trim();
    if(!text) return;
    var player = currentAnswerPlayer();
    state.answers[player.id] = text;
    updateAnswerProgress();
    state.answerIndex++;
    if(state.answerIndex >= state.answerOrder.length){
      startGuessing();
    } else {
      renderAnsweringTurn();
    }
  });

  /* ---------- GUESSING ---------- */

  function startGuessing(){
    var ids = Object.keys(state.answers);
    var pick = ids[Math.floor(Math.random()*ids.length)];
    state.selectedAuthorId = parseInt(pick, 10);
    $('guessing-answer-text').textContent = state.answers[state.selectedAuthorId];
    showScreen('screen-guessing');
    startGuessTimer();
  }

  function formatTime(sec){
    var m = Math.floor(sec/60), s = sec%60;
    return m + ':' + (s<10?'0':'') + s;
  }

  function startGuessTimer(){
    stopGuessTimer();
    state.guessTimeLeft = state.settings.duration;
    $('guess-timer').textContent = formatTime(state.guessTimeLeft);
    state.guessTimerId = setInterval(function(){
      state.guessTimeLeft--;
      $('guess-timer').textContent = formatTime(Math.max(0,state.guessTimeLeft));
      if(state.guessTimeLeft <= 0){
        stopGuessTimer();
        startVoting();
      }
    }, 1000);
  }
  function stopGuessTimer(){
    if(state.guessTimerId){ clearInterval(state.guessTimerId); state.guessTimerId = null; }
  }

  $('btn-guess-player').addEventListener('click', function(){
    stopGuessTimer();
    startVoting();
  });

  /* ---------- VOTING ---------- */

  function startVoting(){
    // The author of the active answer is never allowed to vote on their own answer.
    state.voterOrder = shuffle(state.players.filter(function(p){ return p.id !== state.selectedAuthorId; }).map(function(p){ return p.id; }));
    state.voterIndex = 0;
    showScreen('screen-voting');
    renderVoterTurn();
  }

  function currentVoter(){
    var id = state.voterOrder[state.voterIndex];
    return state.players.filter(function(p){ return p.id === id; })[0];
  }

  function renderVoterTurn(){
    state.selectedVoteTarget = null;
    var voter = currentVoter();
    $('voter-avatar').innerHTML = '<img src="' + charImg(voter.character) + '" alt="">';
    $('voter-turn-text').textContent = "It's " + voter.name + "'s Turn to Guess";

    var grid = $('voting-grid');
    grid.innerHTML = '';
    state.players.forEach(function(p){
      if(p.id === voter.id) return;
      var cell = document.createElement('div');
      cell.className = 'player-cell';
      cell.dataset.target = p.id;
      cell.innerHTML =
        '<div class="player-avatar-wrap"><div class="player-avatar"><img src="' + charImg(p.character) + '" alt=""></div>' +
        '<div class="score-dot">' + p.score + '</div></div>' +
        '<div class="player-name">' + p.name + '</div>';
      cell.addEventListener('click', function(){
        state.selectedVoteTarget = p.id;
        qsa('.player-cell', grid).forEach(function(c){ c.classList.remove('selected'); });
        cell.classList.add('selected');
      });
      grid.appendChild(cell);
    });

    startVoteTimer();
  }

  function startVoteTimer(){
    stopVoteTimer();
    state.voteTimeLeft = VOTE_TIME;
    $('vote-timer').textContent = formatTime(state.voteTimeLeft);
    resumeVoteTimer();
  }
  function resumeVoteTimer(){
    if(state.voteTimerId || state.voteTimeLeft <= 0) return;
    var votingScreen = $('screen-voting');
    if(!votingScreen || votingScreen.hidden || document.visibilityState === 'hidden') return;
    state.voteTimerId = setInterval(function(){
      // Advance only while the current player's voting turn is actually visible.
      if(votingScreen.hidden || document.visibilityState === 'hidden'){
        pauseVoteTimer();
        return;
      }
      state.voteTimeLeft = Math.max(0, state.voteTimeLeft - 1);
      $('vote-timer').textContent = formatTime(state.voteTimeLeft);
      if(state.voteTimeLeft <= 0){
        stopVoteTimer();
        lockVoteAndAdvance();
      }
    }, 1000);
  }
  function pauseVoteTimer(){
    if(state.voteTimerId){ clearInterval(state.voteTimerId); state.voteTimerId = null; }
  }
  function stopVoteTimer(){
    pauseVoteTimer();
    state.voteTimeLeft = 0;
  }
  document.addEventListener('visibilitychange', function(){
    if(document.visibilityState === 'hidden') pauseVoteTimer();
    else if(!$('screen-voting').hidden) resumeVoteTimer();
  });

  function lockVoteAndAdvance(){
    var voter = currentVoter();
    if(state.selectedVoteTarget !== null){
      state.votes[voter.id] = state.selectedVoteTarget;
    }
    state.voterIndex++;
    if(state.voterIndex >= state.voterOrder.length){
      stopVoteTimer();
      showResults();
    } else {
      renderVoterTurn();
    }
  }

  $('btn-vote-player').addEventListener('click', function(){
    if(state.selectedVoteTarget === null) return;
    AudioController.playVoteEffect();
    stopVoteTimer();
    lockVoteAndAdvance();
  });

  /* ---------- RESULTS / SCORING ---------- */

  function showResults(){
    var authorId = state.selectedAuthorId;
    var author = state.players.filter(function(p){ return p.id === authorId; })[0];
    var correctGuessers = [];

    Object.keys(state.votes).forEach(function(voterId){
      var targetId = state.votes[voterId];
      var voter = state.players.filter(function(p){ return p.id === parseInt(voterId,10); })[0];
      if(targetId === authorId){
        voter.score = voter.score + 1;
        correctGuessers.push(voter);
      }
    });

    if(correctGuessers.length > 0){
      author.score = Math.max(0, author.score - 1);
    } else {
      author.score = author.score + 1;
    }

    $('results-avatar').innerHTML = '<img src="' + charImg(author.character) + '" alt="">';
    $('results-author-name').textContent = author.name;
    $('results-author-answer').textContent = '"' + state.answers[authorId] + '"';
    $('results-guessers').textContent = correctGuessers.length > 0
      ? 'Correctly guessed by: ' + correctGuessers.map(function(p){ return p.name; }).join(', ')
      : 'Nobody guessed correctly!';

    var grid = $('results-score-grid');
    grid.innerHTML = '';
    state.players.forEach(function(p){
      var changed = p.id === author.id || correctGuessers.indexOf(p) !== -1;
      var cell = document.createElement('div');
      cell.className = 'player-cell';
      cell.innerHTML =
        '<div class="player-avatar-wrap"><div class="player-avatar"><img src="' + charImg(p.character) + '" alt=""></div></div>' +
        '<div class="player-name">' + p.name + (changed ? ' <span class="score-change">(' + p.score + ')</span>' : ' (' + p.score + ')') + '</div>';
      grid.appendChild(cell);
    });

    $('btn-next-round').textContent = state.round >= state.settings.rounds ? 'VIEW LEADERBOARD \u2192' : 'NEXT ROUND \u2192';
    showScreen('screen-results');
  }

  $('btn-next-round').addEventListener('click', function(){
    if(state.round >= state.settings.rounds){
      showLeaderboard();
    } else {
      nextRound();
    }
  });

  /* ---------- LEADERBOARD ---------- */

  function showLeaderboard(){
    var sorted = state.players.slice().sort(function(a,b){ return b.score - a.score; });

    var podium = $('podium');
    podium.innerHTML = '';
    var places = sorted.slice(0,3);
    var order = [1,0,2]; // visual order: 2nd, 1st, 3rd
    order.forEach(function(i){
      if(!places[i]) return;
      var p = places[i];
      var place = i+1;
      var col = document.createElement('div');
      col.className = 'podium-col podium-place-' + place;
      col.innerHTML =
        '<div class="avatar-ring"><img src="' + charImg(p.character) + '" alt=""></div>' +
        '<div class="player-name">' + p.name + '</div>' +
        '<div class="podium-stand">' + place + '<span class="podium-score">' + p.score + ' pts</span></div>';
      podium.appendChild(col);
    });

    var list = $('leaderboard-list');
    list.innerHTML = '';
    sorted.forEach(function(p, i){
      var row = document.createElement('div');
      row.className = 'leaderboard-row';
      row.innerHTML =
        '<span class="lb-rank">#' + (i+1) + '</span>' +
        '<span class="player-avatar-wrap small-avatar"><span class="player-avatar"><img src="' + charImg(p.character) + '" alt=""></span></span>' +
        '<span class="lb-name">' + p.name + '</span>' +
        '<span class="lb-score">' + p.score + ' pts</span>';
      list.appendChild(row);
    });

    showScreen('screen-leaderboard');
  }

  $('btn-play-again').addEventListener('click', function(){
    state.customQuestions = [];
    state.usedQuestions = [];
    state.unusedPreset = shuffle(PRESET_QUESTIONS);
    state.answers = {};
    state.votes = {};
    state.players.forEach(function(p){ p.score = 0; });
    state.round = 0;
    nextRound();
  });

  $('btn-exit').addEventListener('click', function(){
    stopGuessTimer();
    stopVoteTimer();
    state = freshState();
    renderCount();
    showScreen('screen-home');
  });

  /* ---------- INIT ---------- */

  state = freshState();
  renderCount();
  showScreen('screen-home');
})();

/* ==========================================================================
   Atomic Momentum: Core Dynamic Engine (State, Synthesizers, Timer & Confetti)
   ========================================================================== */

// --- GLOBAL APPLICATION STATE ---
const Store = {
  tasks: [],
  goals: [],
  settings: {
    focusTime: 25,
    shortBreak: 5,
    longBreak: 15,
    longBreakInterval: 4,
    autoFocus: false,
    autoBreaks: false,
    alertTone: 'harp',
    alertVol: 70
  },
  streak: {
    count: 0,
    lastFocusedDate: null
  },
  focusLog: [],

  // Load state from local storage
  load() {
    try {
      const tasks = localStorage.getItem('ff_tasks');
      const goals = localStorage.getItem('ff_goals');
      const settings = localStorage.getItem('ff_settings');
      const streak = localStorage.getItem('ff_streak');
      const focusLog = localStorage.getItem('ff_focusLog');

      if (tasks) this.tasks = JSON.parse(tasks);
      if (goals) this.goals = JSON.parse(goals);
      if (settings) this.settings = { ...this.settings, ...JSON.parse(settings) };
      if (streak) this.streak = JSON.parse(streak);
      if (focusLog) this.focusLog = JSON.parse(focusLog);
      
      this.verifyStreak();
    } catch (e) {
      console.error("Local storage read failure:", e);
    }
  },

  // Save state to local storage
  save() {
    try {
      localStorage.setItem('ff_tasks', JSON.stringify(this.tasks));
      localStorage.setItem('ff_goals', JSON.stringify(this.goals));
      localStorage.setItem('ff_settings', JSON.stringify(this.settings));
      localStorage.setItem('ff_streak', JSON.stringify(this.streak));
      localStorage.setItem('ff_focusLog', JSON.stringify(this.focusLog));
    } catch (e) {
      console.error("Local storage save failure:", e);
    }
  },

  // Verification of focus streak
  verifyStreak() {
    if (!this.streak.lastFocusedDate) return;

    const todayStr = this.getLocalDateString();
    const lastDate = new Date(this.streak.lastFocusedDate);
    const today = new Date(todayStr);

    // Calculate absolute difference in days
    const diffTime = Math.abs(today - lastDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays > 1 && this.streak.lastFocusedDate !== todayStr) {
      this.streak.count = 0; // Streak broken (missed yesterday)
      this.save();
    }
  },

  // Register focus session for streak increment
  registerStreakActivity() {
    const todayStr = this.getLocalDateString();
    if (this.streak.lastFocusedDate === todayStr) {
      return; // Already completed a session today
    }

    if (this.streak.lastFocusedDate) {
      const lastDate = new Date(this.streak.lastFocusedDate);
      const today = new Date(todayStr);
      const diffDays = Math.ceil(Math.abs(today - lastDate) / (1000 * 60 * 60 * 24));

      if (diffDays === 1) {
        this.streak.count += 1;
      } else {
        this.streak.count = 1;
      }
    } else {
      this.streak.count = 1;
    }

    this.streak.lastFocusedDate = todayStr;
    this.save();
  },

  getLocalDateString() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
};


// --- WEB AUDIO API PROCEDURAL AUDIO SYNTHESIZERS ---
const AudioEngine = {
  ctx: null,
  masterGain: null,
  
  // Ambient Sound Nodes
  rain: { node: null, gain: null, playing: false },
  wind: { node: null, gain: null, playing: false },
  hum: { node: null, gain: null, playing: false },
  piano: { interval: null, gain: null, playing: false },

  init() {
    if (this.ctx) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    this.ctx = new AudioContextClass();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.setValueAtTime(0.8, this.ctx.currentTime);
    this.masterGain.connect(this.ctx.destination);
  },

  resumeContext() {
    this.init();
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  },

  // Set individual volumes (val: 0 - 100)
  setVolume(soundType, val) {
    this.resumeContext();
    if (!this.ctx) return;

    const fraction = val / 100;
    
    switch (soundType) {
      case 'rain':
        if (!this.rain.playing && fraction > 0) this.startRain();
        if (this.rain.gain) this.rain.gain.gain.setTargetAtTime(fraction * 0.15, this.ctx.currentTime, 0.2);
        if (fraction === 0) this.stopRain();
        break;
      case 'wind':
        if (!this.wind.playing && fraction > 0) this.startWind();
        if (this.wind.gain) this.wind.gain.gain.setTargetAtTime(fraction * 0.2, this.ctx.currentTime, 0.3);
        if (fraction === 0) this.stopWind();
        break;
      case 'hum':
        if (!this.hum.playing && fraction > 0) this.startHum();
        if (this.hum.gain) this.hum.gain.gain.setTargetAtTime(fraction * 0.08, this.ctx.currentTime, 0.1);
        if (fraction === 0) this.stopHum();
        break;
      case 'cafe':
        if (!this.piano.playing && fraction > 0) this.startAmbientPiano();
        if (this.piano.gain) this.piano.gain.gain.setTargetAtTime(fraction * 0.25, this.ctx.currentTime, 0.2);
        if (fraction === 0) this.stopAmbientPiano();
        break;
    }
  },

  // Procedural Noise Generator Buffer
  createNoiseBuffer(type = 'white') {
    const bufferSize = 2 * this.ctx.sampleRate;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    
    let lastOut = 0.0; // pink filter state
    
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      
      if (type === 'pink') {
        // Pink noise filtering approximation
        output[i] = (lastOut + (0.02 * white)) / 1.02;
        lastOut = output[i];
        output[i] *= 3.5; // Gain compensation
      } else {
        output[i] = white;
      }
    }
    return noiseBuffer;
  },

  // Rain: White Noise + Lowpass Filters
  startRain() {
    if (this.rain.playing) return;
    this.rain.playing = true;

    const source = this.ctx.createBufferSource();
    source.buffer = this.createNoiseBuffer('white');
    source.loop = true;

    // Filters to create ambient water density sound
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(450, this.ctx.currentTime);

    const filter2 = this.ctx.createBiquadFilter();
    filter2.type = 'highpass';
    filter2.frequency.setValueAtTime(40, this.ctx.currentTime);

    this.rain.gain = this.ctx.createGain();
    this.rain.gain.gain.setValueAtTime(0, this.ctx.currentTime);

    source.connect(filter);
    filter.connect(filter2);
    filter2.connect(this.rain.gain);
    this.rain.gain.connect(this.masterGain);

    source.start(0);
    this.rain.node = source;
  },

  stopRain() {
    if (!this.rain.playing) return;
    this.rain.playing = false;
    try {
      if (this.rain.node) this.rain.node.stop();
    } catch(e) {}
    this.rain.node = null;
    this.rain.gain = null;
  },

  // Wind: Pink Noise + Auto-Swept Bandpass Filter + Stereo Auto-Panner
  startWind() {
    if (this.wind.playing) return;
    this.wind.playing = true;

    const source = this.ctx.createBufferSource();
    source.buffer = this.createNoiseBuffer('pink');
    source.loop = true;

    // Swaying wind bandpass filter
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.setValueAtTime(2.0, this.ctx.currentTime);

    // LFO to sweep bandpass center frequency (modulates the wind gust)
    const lfo = this.ctx.createOscillator();
    lfo.frequency.setValueAtTime(0.08, this.ctx.currentTime); // very slow sweep

    const lfoGain = this.ctx.createGain();
    lfoGain.gain.setValueAtTime(180, this.ctx.currentTime); // sweep width (150Hz - 500Hz)

    // Connect LFO sweep
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    filter.frequency.setValueAtTime(320, this.ctx.currentTime);

    // Stereo Panner node for wind direction shifts
    const panner = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    const pannerLfo = this.ctx.createOscillator();
    if (panner) {
      pannerLfo.frequency.setValueAtTime(0.04, this.ctx.currentTime);
      const pannerGain = this.ctx.createGain();
      pannerGain.gain.setValueAtTime(0.6, this.ctx.currentTime); // pan width
      pannerLfo.connect(pannerGain);
      pannerGain.connect(panner.pan);
    }

    this.wind.gain = this.ctx.createGain();
    this.wind.gain.gain.setValueAtTime(0, this.ctx.currentTime);

    source.connect(filter);
    
    if (panner) {
      filter.connect(panner);
      panner.connect(this.wind.gain);
      pannerLfo.start(0);
    } else {
      filter.connect(this.wind.gain);
    }
    
    this.wind.gain.connect(this.masterGain);
    lfo.start(0);
    source.start(0);

    this.wind.node = { source, lfo, pannerLfo };
  },

  stopWind() {
    if (!this.wind.playing) return;
    this.wind.playing = false;
    try {
      if (this.wind.node) {
        this.wind.node.source.stop();
        this.wind.node.lfo.stop();
        if (this.wind.node.pannerLfo) this.wind.node.pannerLfo.stop();
      }
    } catch(e) {}
    this.wind.node = null;
    this.wind.gain = null;
  },

  // Deep Binaural Hum: Two low frequency sine waves detuned by 0.5Hz
  startHum() {
    if (this.hum.playing) return;
    this.hum.playing = true;

    const oscLeft = this.ctx.createOscillator();
    oscLeft.type = 'sine';
    oscLeft.frequency.setValueAtTime(110, this.ctx.currentTime); // A2 Note

    const oscRight = this.ctx.createOscillator();
    oscRight.type = 'sine';
    oscRight.frequency.setValueAtTime(110.5, this.ctx.currentTime); //Detuned by 0.5Hz (binaural beat)

    const channelMerger = this.ctx.createChannelMerger(2);
    
    this.hum.gain = this.ctx.createGain();
    this.hum.gain.gain.setValueAtTime(0, this.ctx.currentTime);

    // Left channel routing
    const pannerLeft = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    const pannerRight = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;

    if (pannerLeft && pannerRight) {
      pannerLeft.pan.setValueAtTime(-1, this.ctx.currentTime);
      pannerRight.pan.setValueAtTime(1, this.ctx.currentTime);
      oscLeft.connect(pannerLeft);
      oscRight.connect(pannerRight);
      pannerLeft.connect(this.hum.gain);
      pannerRight.connect(this.hum.gain);
    } else {
      oscLeft.connect(this.hum.gain);
      oscRight.connect(this.hum.gain);
    }

    this.hum.gain.connect(this.masterGain);
    oscLeft.start(0);
    oscRight.start(0);

    this.hum.node = { oscLeft, oscRight };
  },

  stopHum() {
    if (!this.hum.playing) return;
    this.hum.playing = false;
    try {
      if (this.hum.node) {
        this.hum.node.oscLeft.stop();
        this.hum.node.oscRight.stop();
      }
    } catch(e) {}
    this.hum.node = null;
    this.hum.gain = null;
  },

  // Cozy Procedural Acoustic Cafe Generator (Pentatonic C Major soft piano drops)
  startAmbientPiano() {
    if (this.piano.playing) return;
    this.piano.playing = true;

    this.piano.gain = this.ctx.createGain();
    this.piano.gain.gain.setValueAtTime(0.05, this.ctx.currentTime);
    this.piano.gain.connect(this.masterGain);

    const notes = [130.81, 146.83, 164.81, 196.00, 220.00, 261.63, 293.66, 329.63, 392.00, 440.00]; // Low & Mid C Pentatonic scale
    
    const triggerSoftNote = () => {
      if (!this.piano.playing) return;
      
      const now = this.ctx.currentTime;
      const noteFreq = notes[Math.floor(Math.random() * notes.length)];
      
      const osc = this.ctx.createOscillator();
      const noteGain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(noteFreq, now);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(600, now);

      // Long beautiful piano decay envelope
      noteGain.gain.setValueAtTime(0.001, now);
      noteGain.gain.exponentialRampToValueAtTime(0.12, now + 0.1);
      noteGain.gain.exponentialRampToValueAtTime(0.001, now + 4.5);

      osc.connect(filter);
      filter.connect(noteGain);
      noteGain.connect(this.piano.gain);

      osc.start(now);
      osc.stop(now + 5);

      // Schedule next note with highly relaxing slow random intervals
      const nextDelay = 2500 + Math.random() * 4500;
      this.piano.interval = setTimeout(triggerSoftNote, nextDelay);
    };

    triggerSoftNote();
  },

  stopAmbientPiano() {
    if (!this.piano.playing) return;
    this.piano.playing = false;
    if (this.piano.interval) clearTimeout(this.piano.interval);
    this.piano.interval = null;
    this.piano.gain = null;
  },

  // Play Procedural Notification Alarm Chimes
  playAlert(toneType) {
    this.resumeContext();
    if (!this.ctx) return;

    const volFraction = (Store.settings.alertVol / 100) * 0.4;
    const now = this.ctx.currentTime;

    const triggerArpeggio = (notes) => {
      notes.forEach((freq, idx) => {
        const noteTime = now + (idx * 0.15);
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, noteTime);
        
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1000, noteTime);

        gain.gain.setValueAtTime(0.001, noteTime);
        gain.gain.exponentialRampToValueAtTime(volFraction, noteTime + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 1.2);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain);

        osc.start(noteTime);
        osc.stop(noteTime + 1.5);
      });
    };

    if (toneType === 'harp') {
      // Beautiful Cozy Arpeggio (C4 -> E4 -> G4 -> C5)
      triggerArpeggio([261.63, 329.63, 392.00, 523.25]);
    } else if (toneType === 'digital') {
      // Deep Zen Temple Gong
      const osc = this.ctx.createOscillator();
      const metalOsc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(140, now); // Deep base
      
      metalOsc.type = 'triangle';
      metalOsc.frequency.setValueAtTime(213, now); // Metallic disharmony

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(350, now);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(volFraction * 1.5, now + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 4.0);

      osc.connect(filter);
      metalOsc.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);

      osc.start(now);
      metalOsc.start(now);
      osc.stop(now + 4.5);
      metalOsc.stop(now + 4.5);
    } else if (toneType === 'wood') {
      // Warm rustic coffee cup wood knocks
      const knocks = [0, 0.25];
      knocks.forEach((delay) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(680, now + delay);
        
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(680, now + delay);
        filter.Q.setValueAtTime(4.0, now + delay);

        gain.gain.setValueAtTime(0.001, now + delay);
        gain.gain.exponentialRampToValueAtTime(volFraction * 1.8, now + delay + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.12);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain);

        osc.start(now + delay);
        osc.stop(now + delay + 0.25);
      });
    }
  }
};


// --- HIGH-PRECISION DELTA-TIME POMODORO TIMER ENGINE ---
const TimerEngine = {
  state: 'idle', // idle, running, paused
  type: 'focus', // focus, short, long
  timeLeft: 25 * 60, // in seconds
  totalDuration: 25 * 60,
  intervalId: null,
  lastTickTimestamp: null,
  activeTaskId: null,
  focusSessionsCompletedCount: 0,

  init() {
    this.updateClockDisplay();
    this.bindEvents();
  },

  bindEvents() {
    const playBtn = document.getElementById('timerPlayBtn');
    const skipBtn = document.getElementById('timerSkipBtn');
    const resetBtn = document.getElementById('timerResetBtn');

    playBtn.addEventListener('click', () => {
      AudioEngine.resumeContext();
      if (this.state === 'running') {
        this.pause();
      } else {
        this.start();
      }
    });

    skipBtn.addEventListener('click', () => {
      AudioEngine.resumeContext();
      this.skip();
    });

    resetBtn.addEventListener('click', () => {
      AudioEngine.resumeContext();
      this.reset();
    });

    // Preset pills clicking
    document.querySelectorAll('.preset-pill').forEach(pill => {
      pill.addEventListener('click', (e) => {
        AudioEngine.resumeContext();
        const sessionType = e.target.getAttribute('data-type');
        this.switchSessionType(sessionType, true);
      });
    });

    // Visibility correction to prevent browser sleeping from delaying timer
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.state === 'running') {
        this.syncDeltaTime();
      }
    });
  },

  start() {
    if (this.state === 'running') return;
    
    // Sync current active task representation
    this.syncActiveTaskDisplay();

    this.state = 'running';
    this.lastTickTimestamp = Date.now();
    
    this.intervalId = setInterval(() => {
      this.tick();
    }, 200); // Check high resolution ticks

    this.updatePlayBtnUI();
  },

  pause() {
    if (this.state !== 'running') return;
    this.state = 'paused';
    clearInterval(this.intervalId);
    this.intervalId = null;
    this.updatePlayBtnUI();
  },

  reset() {
    this.pause();
    this.state = 'idle';
    
    let durationMin = Store.settings.focusTime;
    if (this.type === 'short') durationMin = Store.settings.shortBreak;
    if (this.type === 'long') durationMin = Store.settings.longBreak;

    this.timeLeft = durationMin * 60;
    this.totalDuration = durationMin * 60;
    
    this.updateClockDisplay();
    this.updatePlayBtnUI();
  },

  skip() {
    this.pause();
    this.onSessionComplete(true); // Complete prematurely by skipping
  },

  tick() {
    this.syncDeltaTime();
    
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.pause();
      this.onSessionComplete(false);
    } else {
      this.updateClockDisplay();
    }
  },

  // Align elapsed time with real timestamp differences (tab background correction)
  syncDeltaTime() {
    if (!this.lastTickTimestamp) return;
    
    const now = Date.now();
    const elapsedSeconds = (now - this.lastTickTimestamp) / 1000;
    
    if (elapsedSeconds >= 1) {
      this.timeLeft -= Math.floor(elapsedSeconds);
      this.lastTickTimestamp = now - ((elapsedSeconds % 1) * 1000);
    }
  },

  switchSessionType(sessionType, forcedReset = false) {
    if (this.type === sessionType && this.state !== 'idle' && !forcedReset) return;

    this.type = sessionType;
    
    // Highlight preset links
    document.querySelectorAll('.preset-pill').forEach(pill => {
      if (pill.getAttribute('data-type') === sessionType) {
        pill.classList.add('active');
      } else {
        pill.classList.remove('active');
      }
    });

    // Update state pill text
    const labelEl = document.getElementById('sessionLabel');
    if (sessionType === 'focus') {
      labelEl.innerText = "Focus Session";
      document.body.classList.remove('state-break');
    } else if (sessionType === 'short') {
      labelEl.innerText = "Short Break";
      document.body.classList.add('state-break');
    } else {
      labelEl.innerText = "Long Break";
      document.body.classList.add('state-break');
    }

    this.reset();
  },

  onSessionComplete(wasSkipped = false) {
    // Play procedurally synthesized alarm
    AudioEngine.playAlert(Store.settings.alertTone);

    if (!wasSkipped) {
      if (this.type === 'focus') {
        this.focusSessionsCompletedCount++;
        
        // Log activity into database
        const focusDurationMin = Store.settings.focusTime;
        const loggedSession = {
          timestamp: new Date().toISOString(),
          taskId: this.activeTaskId,
          duration: focusDurationMin
        };
        Store.focusLog.push(loggedSession);
        
        // Credit the active task's completed Pomodoro counts
        if (this.activeTaskId) {
          const task = Store.tasks.find(t => t.id === this.activeTaskId);
          if (task) {
            task.actPomodoros = (task.actPomodoros || 0) + 1;
            
            // If linked to a long-term goal, increment goal metrics
            if (task.goalId) {
              const goal = Store.goals.find(g => g.id === task.goalId);
              if (goal) {
                goal.currentPomodoros = (goal.currentPomodoros || 0) + 1;
                // Auto-complete goal if targets met
                if (goal.currentPomodoros >= goal.targetPomodoros) {
                  goal.completed = true;
                }
              }
            }
          }
        }
        
        // Refresh databases and streaks
        Store.registerStreakActivity();
        Store.save();
        App.renderTasks();
        App.renderGoals();
        App.updateDashboardStats();
        
        // Dynamic congratulatory message
        App.showStreakToast();

        // Switch to appropriate break sequence
        if (this.focusSessionsCompletedCount % Store.settings.longBreakInterval === 0) {
          this.switchSessionType('long');
          if (Store.settings.autoBreaks) this.start();
        } else {
          this.switchSessionType('short');
          if (Store.settings.autoBreaks) this.start();
        }

      } else {
        // Break has completed, return back to Focus Session
        this.switchSessionType('focus');
        if (Store.settings.autoFocus) this.start();
      }
    } else {
      // If skipped, simply transition to the next natural block without logging activity
      if (this.type === 'focus') {
        if (this.focusSessionsCompletedCount % Store.settings.longBreakInterval === 0) {
          this.switchSessionType('long');
        } else {
          this.switchSessionType('short');
        }
      } else {
        this.switchSessionType('focus');
      }
    }
  },

  updateClockDisplay() {
    const mins = Math.floor(this.timeLeft / 60);
    const secs = this.timeLeft % 60;
    const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    
    // Update center readout
    document.getElementById('timerClock').innerText = timeStr;
    
    // Update SVG Progress Ring
    const progressCircle = document.querySelector('.timer-progress');
    if (progressCircle) {
      const radius = 88;
      const circumference = 2 * Math.PI * radius; // 552.92
      const percentRemaining = this.timeLeft / this.totalDuration;
      const offset = circumference * (1 - percentRemaining);
      progressCircle.style.strokeDashoffset = offset;
    }

    // Update dynamic tab title
    const stateName = this.type === 'focus' ? 'Focus 🍅' : 'Break ☕';
    document.title = `[${timeStr}] ${stateName} - FocusFlow`;

    // Session cycle label below clock
    const currentCycle = (this.focusSessionsCompletedCount % Store.settings.longBreakInterval) + 1;
    document.getElementById('sessionCounter').innerText = `Session ${currentCycle} of ${Store.settings.longBreakInterval}`;
  },

  updatePlayBtnUI() {
    const playBtn = document.getElementById('timerPlayBtn');
    const playIcon = playBtn.querySelector('.play-icon');
    const pauseIcon = playBtn.querySelector('.pause-icon');

    if (this.state === 'running') {
      playIcon.classList.add('hidden');
      pauseIcon.classList.remove('hidden');
    } else {
      playIcon.classList.remove('hidden');
      pauseIcon.classList.add('hidden');
    }
  },

  syncActiveTaskDisplay() {
    const displayEl = document.getElementById('activeTaskDisplay');
    if (this.activeTaskId) {
      const activeTask = Store.tasks.find(t => t.id === this.activeTaskId);
      if (activeTask) {
        displayEl.innerText = activeTask.title;
        return;
      }
    }
    displayEl.innerText = "Unwinding into Cozy Focus";
  }
};


// --- CUSTOM FULL SCREEN CONFETTI CELEBRATION ---
const ConfettiEngine = {
  canvas: null,
  ctx: null,
  particles: [],
  active: false,
  timerId: null,

  init() {
    this.canvas = document.getElementById('confettiCanvas');
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
  },

  resize() {
    if (this.canvas) {
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
    }
  },

  burst() {
    this.init();
    if (!this.canvas) return;

    this.active = true;
    this.particles = [];
    
    const colors = [
      '#d4a373', '#faedcd', '#f2cc8f', '#81b29a', 
      '#e07a5f', '#b082ee', '#a3cbfb'
    ];

    const particleCount = 120;
    const centerX = this.canvas.width / 2;
    const centerY = this.canvas.height / 2;

    for (let i = 0; i < particleCount; i++) {
      this.particles.push({
        x: centerX,
        y: centerY + 50,
        vx: (Math.random() - 0.5) * 15,
        vy: (Math.random() * -12) - 5,
        size: Math.random() * 8 + 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 10,
        opacity: 1
      });
    }

    if (this.timerId) cancelAnimationFrame(this.timerId);
    this.tick();
  },

  tick() {
    if (!this.active) return;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    let ongoing = false;

    this.particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.35; // gravity pulling down
      p.vx *= 0.98; // horizontal friction
      p.rotation += p.rotationSpeed;
      p.opacity -= 0.012; // slowly dissolve

      if (p.opacity > 0) {
        ongoing = true;
        this.ctx.save();
        this.ctx.translate(p.x, p.y);
        this.ctx.rotate((p.rotation * Math.PI) / 180);
        this.ctx.fillStyle = p.color;
        this.ctx.globalAlpha = p.opacity;
        this.ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        this.ctx.restore();
      }
    });

    if (ongoing) {
      this.timerId = requestAnimationFrame(() => this.tick());
    } else {
      this.active = false;
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }
};


// --- RAIN DROPLET & FLOWER FLOATING CANVAS DYNAMICS ---
const BackgroundVisuals = {
  rainCanvas: null,
  rainCtx: null,
  rainParticles: [],
  rainInterval: null,
  
  particlesContainer: null,

  init() {
    this.rainCanvas = document.getElementById('rainCanvas');
    this.particlesContainer = document.getElementById('cozyParticles');
    this.spawnDriftingLeaves();
  },

  startRainEffect() {
    if (!this.rainCanvas) return;
    this.rainCanvas.classList.remove('hidden-canvas');
    this.rainCtx = this.rainCanvas.getContext('2d');
    
    this.resizeRain();
    window.addEventListener('resize', () => this.resizeRain());

    this.rainParticles = [];
    const maxDrops = 70;
    for (let i = 0; i < maxDrops; i++) {
      this.rainParticles.push({
        x: Math.random() * this.rainCanvas.width,
        y: Math.random() * this.rainCanvas.height,
        len: Math.random() * 20 + 10,
        speed: Math.random() * 8 + 12,
        opacity: Math.random() * 0.15 + 0.05
      });
    }

    const drawRain = () => {
      if (!this.rainCtx) return;
      this.rainCtx.clearRect(0, 0, this.rainCanvas.width, this.rainCanvas.height);
      this.rainCtx.strokeStyle = 'rgba(174, 219, 255, 0.4)';
      this.rainCtx.lineWidth = 1.0;
      
      this.rainParticles.forEach(p => {
        this.rainCtx.globalAlpha = p.opacity;
        this.rainCtx.beginPath();
        this.rainCtx.moveTo(p.x, p.y);
        this.rainCtx.lineTo(p.x - 3, p.y + p.len); // slanted raindrops
        this.rainCtx.stroke();

        p.y += p.speed;
        p.x -= 1.5;

        // Reset droplets wrapping around
        if (p.y > this.rainCanvas.height) {
          p.y = -20;
          p.x = Math.random() * this.rainCanvas.width;
        }
      });

      this.rainInterval = requestAnimationFrame(drawRain);
    };

    drawRain();
  },

  stopRainEffect() {
    if (this.rainInterval) cancelAnimationFrame(this.rainInterval);
    this.rainInterval = null;
    if (this.rainCanvas) {
      this.rainCanvas.classList.add('hidden-canvas');
      const ctx = this.rainCanvas.getContext('2d');
      ctx.clearRect(0, 0, this.rainCanvas.width, this.rainCanvas.height);
    }
  },

  resizeRain() {
    if (this.rainCanvas) {
      this.rainCanvas.width = window.innerWidth;
      this.rainCanvas.height = window.innerHeight;
    }
  },

  // Drifting cozy amber leaf/floral particles
  spawnDriftingLeaves() {
    if (!this.particlesContainer) return;
    this.particlesContainer.innerHTML = '';
    
    const count = 18;
    for (let i = 0; i < count; i++) {
      const leaf = document.createElement('div');
      leaf.className = 'cozy-leaf-particle';
      
      const size = Math.random() * 12 + 6;
      leaf.style.width = `${size}px`;
      leaf.style.height = `${size}px`;
      leaf.style.background = 'rgba(212, 163, 115, 0.1)';
      leaf.style.borderRadius = '50% 0 50% 0'; // leaf shape
      leaf.style.position = 'absolute';
      
      leaf.style.left = `${Math.random() * 100}%`;
      leaf.style.top = `${Math.random() * 100}%`;
      
      // Floating animation variables
      const delay = Math.random() * 10;
      const duration = Math.random() * 20 + 20;
      leaf.style.animation = `driftLeaf ${duration}s linear ${delay}s infinite alternate`;
      
      this.particlesContainer.appendChild(leaf);
    }

    // Inject CSS particle drift keyframe dynamically
    if (!document.getElementById('driftKeyframes')) {
      const style = document.createElement('style');
      style.id = 'driftKeyframes';
      style.innerHTML = `
        @keyframes driftLeaf {
          0% { transform: translate(0, 0) rotate(0deg); opacity: 0.15; }
          50% { transform: translate(40px, -50px) rotate(45deg); opacity: 0.3; }
          100% { transform: translate(-30px, -120px) rotate(110deg); opacity: 0.05; }
        }
      `;
      document.head.appendChild(style);
    }
  }
};


// --- VIEW ORCHESTRATION & BINDINGS ---
const App = {
  init() {
    Store.load();
    TimerEngine.init();
    BackgroundVisuals.init();
    
    this.bindDomElements();
    this.renderTasks();
    this.renderGoals();
    this.updateDashboardStats();
    
    // Set default initial theme setup
    this.setTheme(document.body.className.replace('theme-', '') || 'cafe');
  },

  bindDomElements() {
    // Navigation Tabs
    const tabDaily = document.getElementById('tabDailyBtn');
    const tabVision = document.getElementById('tabVisionBtn');
    const paneDaily = document.getElementById('paneDaily');
    const paneVision = document.getElementById('paneVision');

    tabDaily.addEventListener('click', () => {
      tabDaily.classList.add('active');
      tabVision.classList.remove('active');
      paneDaily.classList.remove('hidden-pane');
      paneVision.classList.add('hidden-pane');
    });

    tabVision.addEventListener('click', () => {
      tabVision.classList.add('active');
      tabDaily.classList.remove('active');
      paneVision.classList.remove('hidden-pane');
      paneDaily.classList.add('hidden-pane');
    });

    // Modals bindings
    this.setupModalControls('themeToggleBtn', 'themeModal', 'themeModalClose');
    this.setupModalControls('statsToggleBtn', 'statsModal', 'statsModalClose');
    this.setupModalControls('settingsToggleBtn', 'settingsModal', 'settingsModalClose');

    // Forms
    document.getElementById('taskForm').addEventListener('submit', (e) => this.handleAddTask(e));
    document.getElementById('goalForm').addEventListener('submit', (e) => this.handleAddGoal(e));
    document.getElementById('settingsForm').addEventListener('submit', (e) => this.handleSaveSettings(e));
    
    // Restore default settings
    document.getElementById('settingsResetBtn').addEventListener('click', () => this.restoreDefaultSettings());

    // Sound Sliders
    this.bindSoundSlider('volWind', 'volWindVal', 'wind');
    this.bindSoundSlider('volRain', 'volRainVal', 'rain');
    this.bindSoundSlider('volCafe', 'volCafeVal', 'cafe');
    this.bindSoundSlider('volHum', 'volHumVal', 'hum');

    // Theme selector click triggers
    document.querySelectorAll('.theme-card-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const selectedTheme = e.currentTarget.getAttribute('data-theme');
        this.setTheme(selectedTheme);
      });
    });

    // Task Filters
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        this.renderTasks(e.target.getAttribute('data-filter'));
      });
    });
  },

  // Standard modal drawer toggle helpers
  setupModalControls(btnId, modalId, closeId) {
    const btn = document.getElementById(btnId);
    const modal = document.getElementById(modalId);
    const close = document.getElementById(closeId);

    btn.addEventListener('click', () => {
      AudioEngine.resumeContext();
      modal.classList.remove('hidden');
      if (btnId === 'statsToggleBtn') this.drawWeeklyStatsChart();
      if (btnId === 'settingsToggleBtn') this.populateSettingsForm();
    });
    
    close.addEventListener('click', () => modal.classList.add('hidden'));
    
    // Close on out-of-bounds tap
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.add('hidden');
    });
  },

  bindSoundSlider(sliderId, valueSpanId, soundType) {
    const slider = document.getElementById(sliderId);
    const valueSpan = document.getElementById(valueSpanId);
    
    slider.addEventListener('input', (e) => {
      const val = e.target.value;
      valueSpan.innerText = `${val}%`;
      AudioEngine.setVolume(soundType, parseInt(val));
    });
  },

  // Atmosphere Layout Shifter
  setTheme(themeName) {
    document.body.className = `theme-${themeName}`;
    
    // Update theme card active borders
    document.querySelectorAll('.theme-card-btn').forEach(btn => {
      if (btn.getAttribute('data-theme') === themeName) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Toggle Rain droplet graphic layers
    if (themeName === 'rainy') {
      BackgroundVisuals.startRainEffect();
    } else {
      BackgroundVisuals.stopRainEffect();
    }

    // Morph the active color glows on the backgrounds
    const bgAura = document.getElementById('bgAura');
    if (bgAura) {
      bgAura.style.transition = 'var(--transition-smooth)';
    }
  },

  // --- GOAL ACTIONS ---
  handleAddGoal(e) {
    e.preventDefault();
    const title = document.getElementById('goalTitle').value.trim();
    const category = document.getElementById('goalCategory').value;
    const targetChunks = parseInt(document.getElementById('goalMilestoneTarget').value);

    if (!title) return;

    const newGoal = {
      id: 'g_' + Date.now(),
      title,
      category,
      targetPomodoros: targetChunks,
      currentPomodoros: 0,
      completed: false
    };

    Store.goals.push(newGoal);
    Store.save();
    
    document.getElementById('goalForm').reset();
    
    this.renderGoals();
    this.populateGoalLinkDropdown();
    this.updateDashboardStats();
    
    ConfettiEngine.burst();
  },

  renderGoals() {
    const container = document.getElementById('goalsGridContainer');
    if (!container) return;

    if (Store.goals.length === 0) {
      container.innerHTML = `
        <div class="cozy-empty-state">
          <span class="empty-emoji">🌟</span>
          <p>Define a high-level milestone to align your path. Tasks you connect to this goal will feed its progress bar!</p>
        </div>
      `;
      return;
    }

    container.innerHTML = '';
    Store.goals.forEach(goal => {
      const percentage = Math.min(Math.round((goal.currentPomodoros / goal.targetPomodoros) * 100), 100);
      const isCompleted = goal.completed || percentage >= 100;
      
      const card = document.createElement('div');
      card.className = `goal-card ${isCompleted ? 'completed' : ''}`;
      card.innerHTML = `
        <div class="goal-card-header">
          <h4 class="goal-card-title">${goal.title}</h4>
          <button class="goal-delete-btn" data-id="${goal.id}" title="Remove Goal">&times;</button>
        </div>
        <div class="goal-card-metadata">
          <span class="goal-category-pill">${goal.category}</span>
          <span class="goal-chunks-pills">🍅 ${goal.currentPomodoros} / ${goal.targetPomodoros} chunks</span>
        </div>
        <div class="goal-progress-box">
          <div class="progress-labels">
            <span>Development</span>
            <span class="progress-percentage">${percentage}%</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" style="width: ${percentage}%"></div>
          </div>
        </div>
      `;

      // Event binding inside
      card.querySelector('.goal-delete-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        this.handleDeleteGoal(goal.id);
      });

      container.appendChild(card);
    });
  },

  handleDeleteGoal(goalId) {
    Store.goals = Store.goals.filter(g => g.id !== goalId);
    
    // Decouple any linked daily tasks
    Store.tasks.forEach(t => {
      if (t.goalId === goalId) t.goalId = '';
    });

    Store.save();
    this.renderGoals();
    this.renderTasks();
    this.populateGoalLinkDropdown();
    this.updateDashboardStats();
  },

  populateGoalLinkDropdown() {
    const select = document.getElementById('taskGoalLink');
    if (!select) return;
    
    // Clear and restore personal
    select.innerHTML = '<option value="">Personal Focus 🌿</option>';
    
    Store.goals.forEach(g => {
      if (!g.completed) {
        select.innerHTML += `<option value="${g.id}">${g.title}</option>`;
      }
    });
  },

  // --- TASK ACTIONS ---
  handleAddTask(e) {
    e.preventDefault();
    const title = document.getElementById('taskTitle').value.trim();
    const estPomos = parseInt(document.getElementById('taskEstPomodoros').value);
    const priority = document.getElementById('taskPriority').value;
    const goalId = document.getElementById('taskGoalLink').value;

    if (!title) return;

    const newTask = {
      id: 't_' + Date.now(),
      title,
      estPomodoros: estPomos,
      actPomodoros: 0,
      priority,
      goalId,
      completed: false
    };

    Store.tasks.push(newTask);
    Store.save();
    
    // Reset form Title only
    document.getElementById('taskTitle').value = '';
    
    this.renderTasks();
    
    // If no active task currently selected, default to this newly added one!
    if (!TimerEngine.activeTaskId) {
      this.setActiveTask(newTask.id);
    }
  },

  renderTasks(filter = 'all') {
    const container = document.getElementById('taskListContainer');
    if (!container) return;

    const filtered = Store.tasks.filter(t => {
      if (filter === 'active') return !t.completed;
      if (filter === 'completed') return t.completed;
      return true;
    });

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="cozy-empty-state">
          <span class="empty-emoji">☕</span>
          <p>No tasks matching this filter. Relax, or add a new goal above!</p>
        </div>
      `;
      return;
    }

    container.innerHTML = '';
    filtered.forEach(task => {
      const isTimerActive = TimerEngine.activeTaskId === task.id;
      const linkedGoal = Store.goals.find(g => g.id === task.goalId);
      
      const item = document.createElement('div');
      item.className = `task-item ${task.completed ? 'completed' : ''} ${isTimerActive ? 'active-session-task' : ''}`;
      item.innerHTML = `
        <div class="priority-accent priority-${task.priority}"></div>
        <div class="task-check-wrap">
          <button class="task-checkbox-custom" title="Toggle Completion">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
            </svg>
          </button>
        </div>
        <div class="task-item-content">
          <span class="task-title-text" contenteditable="${!task.completed}" title="Double click to edit text inline">${task.title}</span>
          <div class="task-meta-pills">
            <span class="item-pill pomodoro-item-counter">🍅 ${task.actPomodoros || 0} / ${task.estPomodoros} chunks</span>
            <span class="item-pill priority-pill">${task.priority}</span>
            ${linkedGoal ? `<span class="item-pill goal-connection">🌟 ${linkedGoal.title}</span>` : ''}
          </div>
        </div>
        <div class="task-actions">
          <button class="task-action-btn focus-action" title="Set Active to Timer">🎯</button>
          <button class="task-action-btn delete" title="Delete Task">🗑️</button>
        </div>
      `;

      // Complete click bindings
      item.querySelector('.task-checkbox-custom').addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleTaskCompletion(task.id);
      });

      // Bind Focus Target selection
      item.querySelector('.focus-action').addEventListener('click', (e) => {
        e.stopPropagation();
        this.setActiveTask(task.id);
      });

      // Bind Delete Click
      item.querySelector('.delete').addEventListener('click', (e) => {
        e.stopPropagation();
        this.handleDeleteTask(task.id);
      });

      // Inline double-click title editing bindings
      const titleSpan = item.querySelector('.task-title-text');
      
      titleSpan.addEventListener('blur', (e) => {
        const text = e.target.innerText.trim();
        if (text) {
          task.title = text;
          Store.save();
          TimerEngine.syncActiveTaskDisplay();
        } else {
          e.target.innerText = task.title;
        }
      });
      
      titleSpan.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          titleSpan.blur();
        }
      });

      // Row clicking to set active (if not completed)
      item.addEventListener('click', (e) => {
        if (!task.completed && !e.target.classList.contains('task-checkbox-custom') && !e.target.closest('.task-actions')) {
          this.setActiveTask(task.id);
        }
      });

      container.appendChild(item);
    });

    this.populateGoalLinkDropdown();
  },

  toggleTaskCompletion(taskId) {
    const task = Store.tasks.find(t => t.id === taskId);
    if (!task) return;

    task.completed = !task.completed;
    
    if (task.completed) {
      ConfettiEngine.burst();
      // Satisfying soft acoustic check sound
      AudioEngine.playAlert('wood');
      
      // If completed task was the active focus, clear active timer pointer
      if (TimerEngine.activeTaskId === taskId) {
        TimerEngine.activeTaskId = null;
        TimerEngine.syncActiveTaskDisplay();
      }
    }

    Store.save();
    this.renderTasks();
    this.renderGoals();
    this.updateDashboardStats();
  },

  handleDeleteTask(taskId) {
    Store.tasks = Store.tasks.filter(t => t.id !== taskId);
    
    if (TimerEngine.activeTaskId === taskId) {
      TimerEngine.activeTaskId = null;
      TimerEngine.syncActiveTaskDisplay();
    }

    Store.save();
    this.renderTasks();
    this.updateDashboardStats();
  },

  setActiveTask(taskId) {
    const task = Store.tasks.find(t => t.id === taskId);
    if (!task || task.completed) return;

    TimerEngine.activeTaskId = taskId;
    TimerEngine.syncActiveTaskDisplay();
    
    // Rerender task rows to highlight active
    this.renderTasks();
  },

  // --- STATS OVERVIEW UPDATES ---
  updateDashboardStats() {
    // Total Focus Time calculation
    const totalMinutes = Store.focusLog.reduce((acc, log) => acc + log.duration, 0);
    const totalHours = (totalMinutes / 60).toFixed(1);
    
    const countCompletedPomodoros = Store.focusLog.length;
    
    // Update Streak HTML Displays
    document.getElementById('streakCount').innerText = Store.streak.count;
    
    // Populate Analytics modal numbers
    document.getElementById('statsHours').innerText = totalHours;
    document.getElementById('statsCompletedPomodoros').innerText = countCompletedPomodoros;
    document.getElementById('statsStreak').innerText = Store.streak.count;
    document.getElementById('statsGoalsCount').innerText = Store.goals.filter(g => !g.completed).length;

    // Render detailed timeline logs in modal
    this.renderFocusHistoryLogs();
  },

  renderFocusHistoryLogs() {
    const container = document.getElementById('statsHistoryContainer');
    if (!container) return;

    if (Store.focusLog.length === 0) {
      container.innerHTML = '<p class="empty-history-text">No recorded focus sessions yet. Let\'s make today count!</p>';
      return;
    }

    container.innerHTML = '';
    // Display in reverse order (most recent first)
    const logs = [...Store.focusLog].reverse();
    logs.forEach(log => {
      const date = new Date(log.timestamp);
      const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
      
      const task = Store.tasks.find(t => t.id === log.taskId);
      const taskName = task ? task.title : 'General Unwinding Focus';
      
      const item = document.createElement('div');
      item.className = 'history-log-item';
      item.innerHTML = `
        <div class="history-log-meta">
          <span class="history-log-time">${dateStr} @ ${timeStr}</span>
          <span class="history-log-task">${taskName}</span>
        </div>
        <span class="history-log-dur">+${log.duration}m</span>
      `;
      container.appendChild(item);
    });
  },

  // Custom visual SVG chart creation mapping last 7 days of completed pomodoros
  drawWeeklyStatsChart() {
    const g = document.getElementById('chartSvgContent');
    if (!g) return;

    if (Store.focusLog.length === 0) {
      g.innerHTML = `<text x="200" y="80" fill="rgba(255,255,255,0.4)" font-size="12" text-anchor="middle">Log your first session to see weekly trends!</text>`;
      return;
    }

    // Group focus logs by last 7 days
    const daysData = {};
    const labels = [];
    
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      daysData[key] = 0;
      labels.push(d.toLocaleDateString([], { weekday: 'short' }));
    }

    Store.focusLog.forEach(log => {
      const logDate = log.timestamp.split('T')[0];
      if (daysData[logDate] !== undefined) {
        daysData[logDate] += 1;
      }
    });

    const values = Object.values(daysData);
    const maxVal = Math.max(...values, 4); // Normal scaling threshold minimum

    // SVG coordinates setup
    const width = 340;
    const height = 110;
    const paddingLeft = 40;
    const paddingBottom = 20;

    const colWidth = (width - paddingLeft) / 7;
    
    let pathD = '';
    let circlesHtml = '';
    let textsHtml = '';

    values.forEach((val, idx) => {
      const x = paddingLeft + (idx * colWidth) + (colWidth / 2);
      const y = height - paddingBottom - ((val / maxVal) * (height - 30));

      if (idx === 0) {
        pathD += `M ${x} ${y}`;
      } else {
        pathD += ` L ${x} ${y}`;
      }

      circlesHtml += `<circle cx="${x}" cy="${y}" r="4" fill="#dd9d60" stroke="#120e0c" stroke-width="1.5" />`;
      
      // Floating numeric counts
      if (val > 0) {
        textsHtml += `<text x="${x}" y="${y - 8}" fill="#faf8f5" font-size="9" text-anchor="middle" font-family="var(--font-mono)">${val}</text>`;
      }
      
      // Day Label underneath
      textsHtml += `<text x="${x}" y="${height - 2}" fill="rgba(255,255,255,0.4)" font-size="9" text-anchor="middle">${labels[idx]}</text>`;
    });

    // Populate chart group content
    g.innerHTML = `
      <!-- Line graph path -->
      <path d="${pathD}" fill="none" stroke="rgba(221, 157, 96, 0.4)" stroke-width="2.5" />
      <path d="${pathD} L ${paddingLeft + (6 * colWidth) + (colWidth / 2)} ${height - paddingBottom} L ${paddingLeft + (colWidth / 2)} ${height - paddingBottom} Z" fill="url(#chartFadeGradient)" opacity="0.15" />
      ${circlesHtml}
      ${textsHtml}
    `;

    // Ensure gradient def is available inside Chart wrapper
    const svgEl = g.closest('svg');
    if (svgEl && !svgEl.querySelector('#chartFadeGradient')) {
      const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      defs.innerHTML = `
        <linearGradient id="chartFadeGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#dd9d60"/>
          <stop offset="100%" stop-color="transparent"/>
        </linearGradient>
      `;
      svgEl.appendChild(defs);
    }
  },

  // --- CONFIGURATION SETTINGS CONTROL ---
  populateSettingsForm() {
    document.getElementById('setFocusTime').value = Store.settings.focusTime;
    document.getElementById('setShortBreak').value = Store.settings.shortBreak;
    document.getElementById('setLongBreak').value = Store.settings.longBreak;
    document.getElementById('setLongBreakInterval').value = Store.settings.longBreakInterval;
    
    document.getElementById('setAutoFocus').checked = Store.settings.autoFocus;
    document.getElementById('setAutoBreaks').checked = Store.settings.autoBreaks;
    document.getElementById('setAlertTone').value = Store.settings.alertTone;
    document.getElementById('setAlertVol').value = Store.settings.alertVol;
    document.getElementById('setAlertVolVal').innerText = `${Store.settings.alertVol}%`;
  },

  handleSaveSettings(e) {
    e.preventDefault();
    
    Store.settings.focusTime = parseInt(document.getElementById('setFocusTime').value);
    Store.settings.shortBreak = parseInt(document.getElementById('setShortBreak').value);
    Store.settings.longBreak = parseInt(document.getElementById('setLongBreak').value);
    Store.settings.longBreakInterval = parseInt(document.getElementById('setLongBreakInterval').value);
    
    Store.settings.autoFocus = document.getElementById('setAutoFocus').checked;
    Store.settings.autoBreaks = document.getElementById('setAutoBreaks').checked;
    Store.settings.alertTone = document.getElementById('setAlertTone').value;
    
    const vol = parseInt(document.getElementById('setAlertVol').value);
    Store.settings.alertVol = vol;

    Store.save();
    
    // Close modal settings
    document.getElementById('settingsModal').classList.add('hidden');
    
    // Apply changes onto Timer engine
    TimerEngine.reset();
  },

  restoreDefaultSettings() {
    document.getElementById('setFocusTime').value = 25;
    document.getElementById('setShortBreak').value = 5;
    document.getElementById('setLongBreak').value = 15;
    document.getElementById('setLongBreakInterval').value = 4;
    document.getElementById('setAutoFocus').checked = false;
    document.getElementById('setAutoBreaks').checked = false;
    document.getElementById('setAlertTone').value = 'harp';
    document.getElementById('setAlertVol').value = 70;
    document.getElementById('setAlertVolVal').innerText = '70%';
  },

  showStreakToast() {
    // Elegant soft toast animation wiggling the streak badge
    const badge = document.getElementById('streakBadge');
    if (badge) {
      badge.style.transform = 'scale(1.3) rotate(-5deg)';
      setTimeout(() => {
        badge.style.transform = 'scale(1.0) rotate(0deg)';
      }, 800);
    }
  }
};


// --- INITIALIZATION ---
window.addEventListener('DOMContentLoaded', () => {
  App.init();
});

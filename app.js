/**
 * Motor de áudio dinâmico sintetizado via Web Audio API.
 */
class RainAudioEngine {
    constructor() {
        this.ctx = null;
        this.noiseNode = null;
        this.filterNode = null;
        this.gainNode = null;
        this.isMuted = localStorage.getItem('rain_sim_muted') === 'true';
        this.intensity = 500;
    }

    init() {
        if (this.ctx) return;
        
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioContextClass();
        
        // Criar buffer de ruído branco
        const bufferSize = 2 * this.ctx.sampleRate;
        const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            output[i] = Math.random() * 2 - 1;
        }
        
        this.noiseNode = this.ctx.createBufferSource();
        this.noiseNode.buffer = noiseBuffer;
        this.noiseNode.loop = true;
        
        this.filterNode = this.ctx.createBiquadFilter();
        this.filterNode.type = 'lowpass';
        
        this.gainNode = this.ctx.createGain();
        
        this.noiseNode.connect(this.filterNode);
        this.filterNode.connect(this.gainNode);
        this.gainNode.connect(this.ctx.destination);
        
        this.updateParams();
        
        this.noiseNode.start(0);
        
        if (this.isMuted) {
            this.gainNode.gain.setValueAtTime(0, this.ctx.currentTime);
        }
    }

    updateParams(intensity = this.intensity, isRunning = true) {
        this.intensity = intensity;
        if (!this.ctx) return;
        
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }

        if (this.isMuted || !isRunning) {
            this.gainNode.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
            return;
        }

        // Mapeia intensidade para ganho de volume (0.01 a 0.09)
        const targetGain = 0.01 + (this.intensity - 100) / 1400 * 0.08;
        this.gainNode.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.2);

        // Mapeia intensidade para a frequência de corte (350Hz a 1000Hz)
        const targetFreq = 350 + (this.intensity - 100) / 1400 * 650;
        this.filterNode.frequency.setTargetAtTime(targetFreq, this.ctx.currentTime, 0.2);
    }

    toggleMute() {
        this.isMuted = !this.isMuted;
        localStorage.setItem('rain_sim_muted', this.isMuted);
        this.updateParams(this.intensity, true);
        return this.isMuted;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // ----------------------------------------------------------------------
    // Elementos do DOM
    // ----------------------------------------------------------------------
    const canvas = document.getElementById('simulation-canvas');
    const ctx = canvas.getContext('2d');

    // Sliders de Controle
    const controlSpeed = document.getElementById('control-speed');
    const controlAngle = document.getElementById('control-angle');
    const controlIntensity = document.getElementById('control-intensity');
    const controlWind = document.getElementById('control-wind');
    const controlRainSpeed = document.getElementById('control-rain-speed');
    const expSpeedInput = document.getElementById('experiment-speed-input');

    // Elementos de Exibição dos Valores
    const valSpeed = document.getElementById('val-speed');
    const valAngle = document.getElementById('val-angle');
    const valIntensity = document.getElementById('val-intensity');
    const valWind = document.getElementById('val-wind');
    const valRainSpeed = document.getElementById('val-rain-speed');
    const valExpSpeed = document.getElementById('val-exp-speed');

    // Botões
    const btnPlayPause = document.getElementById('btn-play-pause');
    const btnReset = document.getElementById('btn-reset');
    const btnRunExperiment = document.getElementById('btn-run-experiment');
    const btnClearHistory = document.getElementById('btn-clear-history');
    const btnToggleSound = document.getElementById('btn-toggle-sound');
    
    // Controles de Modo de Movimento
    const btnModeAuto = document.getElementById('btn-mode-auto');
    const btnModeManual = document.getElementById('btn-mode-manual');
    const controlHint = document.getElementById('control-hint');

    // Métricas do Dashboard
    const wetnessIndicator = document.getElementById('wetness-indicator');
    const wetnessPercentage = document.getElementById('wetness-percentage');
    const statsHit = document.getElementById('stats-hit');
    const statsBlocked = document.getElementById('stats-blocked');
    const statsEfficiency = document.getElementById('stats-efficiency');

    // Overlay de Experimento
    const experimentOverlay = document.getElementById('experiment-overlay');
    const overlayTitle = document.getElementById('overlay-title');
    const overlayDescription = document.getElementById('overlay-description');
    const experimentProgress = document.getElementById('experiment-progress');
    const experimentDistanceText = document.getElementById('experiment-distance-text');

    // Resultados e Histórico
    const experimentResults = document.getElementById('experiment-results');
    const resSpeed = document.getElementById('res-speed');
    const resTime = document.getElementById('res-time');
    const resWater = document.getElementById('res-water');
    const experimentHistory = document.getElementById('experiment-history');

    // Modal Teórico
    const theoryModal = document.getElementById('theory-modal');
    const btnOpenTheory = document.getElementById('btn-open-theory');
    const btnCloseTheory = document.getElementById('btn-close-theory');

    // Seletor de Distância do Experimento
    const expDistanceSelect = document.getElementById('experiment-distance-select');

    // ----------------------------------------------------------------------
    // Configurações e Estado do Simulador
    // ----------------------------------------------------------------------
    let isRunning = true;
    let mode = 'free'; // 'free' ou 'experiment'
    let isTerminated = false; // Rastreia se a simulação foi terminada/concluída prematuramente
    let movementMode = 'auto'; // 'auto' ou 'manual'
    const keysPressed = {};
    
    // Instancia o motor de áudio
    const audioEngine = new RainAudioEngine();
    
    // Configurações Físicas Gerais
    const gravity = 9.8;
    let rainIntensity = parseInt(controlIntensity.value); // Gotas geradas por segundo
    let windSpeed = parseFloat(controlWind.value);        // Velocidade natural do vento (X)
    let rainFallSpeed = parseFloat(controlRainSpeed.value); // Velocidade de queda base da chuva (Y)
    
    // Estado de Movimento da Pessoa (Velocidade Livre)
    let targetSpeedKmh = parseFloat(controlSpeed.value);
    let currentSpeedKmh = targetSpeedKmh;
    let umbrellaTargetAngle = parseFloat(controlAngle.value);

    // Contadores de Colisão
    let totalHit = 0;
    let totalBlocked = 0;

    // Listas de Entidades
    let particles = [];
    let splashes = [];

    // Chão e Posicionamento
    let groundY = 0;
    let roadOffset = 0;

    // Inicializa a Pessoa e o Guarda-Chuva com fator global de escala proporcional (1.5x)
    const SIMULATION_SCALE = 1.5;
    const person = new Person(0, 0, SIMULATION_SCALE);
    const umbrella = new Umbrella(55, 75, SIMULATION_SCALE);

    // Estado do Experimento (Distância Configurável)
    let experimentDistance = 0;
    let targetDistance = parseInt(expDistanceSelect.value); // metros
    let experimentTime = 0;     // segundos virtuais
    let savedFreeSpeedKmh = 4;  // Guarda a velocidade anterior ao iniciar o teste
    let lastTime = performance.now();

    // Inicialização do áudio por gestos do usuário
    function initAudioOnInteraction() {
        audioEngine.init();
        document.removeEventListener('click', initAudioOnInteraction);
        document.removeEventListener('keydown', initAudioOnInteraction);
    }
    document.addEventListener('click', initAudioOnInteraction);
    document.addEventListener('keydown', initAudioOnInteraction);

    function updateAudio() {
        audioEngine.updateParams(rainIntensity, isRunning);
    }

    // ----------------------------------------------------------------------
    // Configurações de Redimensionamento do Canvas
    // ----------------------------------------------------------------------
    function resizeCanvas() {
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = rect.height;
        
        // Define a linha de terra em relação à altura do canvas
        groundY = canvas.height - 50;
        
        // Posiciona a pessoa no centro horizontalmente
        person.x = canvas.width / 2;
        person.y = groundY;
    }
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    // ----------------------------------------------------------------------
    // Atualização de Valores nos Controles da Interface
    // ----------------------------------------------------------------------
    function updateControlLabels() {
        valSpeed.textContent = `${currentSpeedKmh.toFixed(1)} km/h`;
        valAngle.textContent = `${umbrellaTargetAngle}°`;
        
        // Intensidade
        if (rainIntensity < 300) valIntensity.textContent = 'Garoa';
        else if (rainIntensity < 800) valIntensity.textContent = 'Média';
        else if (rainIntensity < 1200) valIntensity.textContent = 'Forte';
        else valIntensity.textContent = 'Temporal';

        // Vento
        if (windSpeed === 0) valWind.textContent = 'Sem Vento';
        else if (windSpeed > 0) valWind.textContent = `Leste (${windSpeed} m/s)`;
        else valWind.textContent = `Oeste (${Math.abs(windSpeed)} m/s)`;

        // Gravidade/Velocidade de queda
        if (rainFallSpeed < 8) valRainSpeed.textContent = 'Lenta (Névoa)';
        else if (rainFallSpeed < 13) valRainSpeed.textContent = 'Normal';
        else valRainSpeed.textContent = 'Rápida (Tempestade)';
        
        valExpSpeed.textContent = `${expSpeedInput.value} km/h`;
    }

    // ----------------------------------------------------------------------
    // Listeners de Eventos (Sliders e Botões)
    // ----------------------------------------------------------------------
    controlSpeed.addEventListener('input', (e) => {
        if (mode === 'free') {
            targetSpeedKmh = parseFloat(e.target.value);
            removePresetActiveStates();
            highlightClosestPreset(targetSpeedKmh);
        }
    });

    controlAngle.addEventListener('input', (e) => {
        umbrellaTargetAngle = parseFloat(e.target.value);
        updateControlLabels();
    });

    controlIntensity.addEventListener('input', (e) => {
        rainIntensity = parseInt(e.target.value);
        updateControlLabels();
        updateAudio();
    });

    controlWind.addEventListener('input', (e) => {
        windSpeed = parseFloat(e.target.value);
        updateControlLabels();
    });

    controlRainSpeed.addEventListener('input', (e) => {
        rainFallSpeed = parseFloat(e.target.value);
        updateControlLabels();
    });

    expSpeedInput.addEventListener('input', (e) => {
        valExpSpeed.textContent = `${e.target.value} km/h`;
    });

    // Preset buttons
    const presetButtons = document.querySelectorAll('.preset-btn');
    presetButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (mode !== 'free') return;
            removePresetActiveStates();
            btn.classList.add('active');
            targetSpeedKmh = parseFloat(btn.dataset.speed);
            controlSpeed.value = targetSpeedKmh;
            updateControlLabels();
        });
    });

    function removePresetActiveStates() {
        presetButtons.forEach(b => b.classList.remove('active'));
    }

    function highlightClosestPreset(speed) {
        presetButtons.forEach(b => {
            if (parseFloat(b.dataset.speed) === speed) {
                b.classList.add('active');
            }
        });
    }

    // Alternância de modo de movimento
    if (btnModeAuto && btnModeManual && controlHint) {
        btnModeAuto.addEventListener('click', () => {
            movementMode = 'auto';
            btnModeAuto.classList.add('active');
            btnModeManual.classList.remove('active');
            controlHint.classList.add('hidden');
        });

        btnModeManual.addEventListener('click', () => {
            movementMode = 'manual';
            btnModeManual.classList.add('active');
            btnModeAuto.classList.remove('active');
            controlHint.classList.remove('hidden');
            // Garante que a velocidade inicial desejada seja carregada do slider
            targetSpeedKmh = parseFloat(controlSpeed.value);
        });
    }

    // Controle por teclado: Guarda-chuva (Q/E), Movimentação Manual (A/D ou Setas Horizontais) e Velocidade (W/S ou Setas Verticais)
    window.addEventListener('keydown', (e) => {
        // Registra o estado da tecla pressionada
        keysPressed[e.key] = true;
        
        let changed = false;
        
        // Rotação do guarda-chuva apenas com Q/E (q/e) para evitar conflitos de locomoção
        if (e.key === 'q' || e.key === 'Q') {
            umbrellaTargetAngle = Math.max(-45, umbrellaTargetAngle - 5);
            changed = true;
        } else if (e.key === 'e' || e.key === 'E') {
            umbrellaTargetAngle = Math.min(45, umbrellaTargetAngle + 5);
            changed = true;
        } else if (e.key === ' ' || e.code === 'Space') {
            btnPlayPause.click();
            e.preventDefault();
        } else if (e.key === 'Escape') {
            if (mode === 'experiment') {
                cancelExperiment();
            }
            e.preventDefault();
        }

        // Se estiver no modo manual, as teclas verticais (setas ou W/S) ajustam a velocidade desejada
        if (movementMode === 'manual' && mode === 'free') {
            if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
                targetSpeedKmh = Math.min(25, targetSpeedKmh + 0.5);
                controlSpeed.value = targetSpeedKmh;
                removePresetActiveStates();
                highlightClosestPreset(targetSpeedKmh);
                updateControlLabels();
                e.preventDefault();
            } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
                targetSpeedKmh = Math.max(0, targetSpeedKmh - 0.5);
                controlSpeed.value = targetSpeedKmh;
                removePresetActiveStates();
                highlightClosestPreset(targetSpeedKmh);
                updateControlLabels();
                e.preventDefault();
            }
        }

        if (changed) {
            controlAngle.value = umbrellaTargetAngle;
            updateControlLabels();
            e.preventDefault();
        }
    });

    window.addEventListener('keyup', (e) => {
        keysPressed[e.key] = false;
        // Normaliza para evitar problemas de capitalização
        if (e.key === 'a' || e.key === 'A') {
            keysPressed['a'] = false;
            keysPressed['A'] = false;
        }
        if (e.key === 'd' || e.key === 'D') {
            keysPressed['d'] = false;
            keysPressed['D'] = false;
        }
        if (e.key === 'w' || e.key === 'W') {
            keysPressed['w'] = false;
            keysPressed['W'] = false;
        }
        if (e.key === 's' || e.key === 'S') {
            keysPressed['s'] = false;
            keysPressed['S'] = false;
        }
    });

    // Seletor de distância do experimento
    expDistanceSelect.addEventListener('change', (e) => {
        targetDistance = parseInt(e.target.value);
    });

    // Botão de Áudio (Mute/Unmute)
    function updateSoundButtonUI() {
        if (audioEngine.isMuted) {
            btnToggleSound.textContent = '🔇 Som: OFF';
            btnToggleSound.classList.add('muted');
        } else {
            btnToggleSound.textContent = '🔊 Som: ON';
            btnToggleSound.classList.remove('muted');
        }
    }

    btnToggleSound.addEventListener('click', () => {
        audioEngine.init();
        const isMuted = audioEngine.toggleMute();
        updateSoundButtonUI();
        updateAudio();
    });

    // Inicialização da UI do botão
    updateSoundButtonUI();

    // Botão de Play/Pause
    btnPlayPause.addEventListener('click', () => {
        if (!isRunning && isTerminated) {
            // Se a simulação estava terminada, zera tudo ao iniciar uma nova corrida
            totalHit = 0;
            totalBlocked = 0;
            person.wetness = 0;
            person.wetnessHead = 0;
            person.wetnessBody = 0;
            person.wetnessLegs = 0;
            particles = [];
            splashes = [];
            person.x = canvas.width / 2;
            isTerminated = false;
            experimentResults.classList.add('hidden');
            updateDashboard();
        }

        isRunning = !isRunning;
        btnPlayPause.textContent = isRunning ? 'Pausar' : 'Iniciar';
        btnPlayPause.classList.toggle('btn-primary', isRunning);
        btnPlayPause.classList.toggle('btn-secondary', !isRunning);
        
        updateAudio();
        if (isRunning) {
            lastTime = performance.now();
            requestAnimationFrame(simulationLoop);
        }
    });

    // Botão flutuante do Canvas removido

    // Função para resetar as métricas e limpar a simulação no modo livre
    function resetFreeSimulation() {
        totalHit = 0;
        totalBlocked = 0;
        person.wetness = 0;
        person.wetnessHead = 0;
        person.wetnessBody = 0;
        person.wetnessLegs = 0;
        particles = [];
        splashes = [];
        person.x = canvas.width / 2; // Centraliza o boneco no modo livre
        isTerminated = false;
        
        experimentResults.classList.add('hidden');
        
        updateControlLabels();
        highlightClosestPreset(targetSpeedKmh);
        updateDashboard();
        updateAudio();
    }

    // Vincula o botão de resetar
    if (btnReset) {
        btnReset.addEventListener('click', resetFreeSimulation);
    }

    // ----------------------------------------------------------------------
    // Atualização do Dashboard e Reservatório de Água
    // ----------------------------------------------------------------------
    function updateDashboard() {
        statsHit.textContent = Math.round(totalHit);
        statsBlocked.textContent = Math.round(totalBlocked);
        
        // Calcula eficiência do guarda-chuva
        const total = totalHit + totalBlocked;
        const efficiency = total === 0 ? 100 : (totalBlocked / total) * 100;
        statsEfficiency.textContent = `${efficiency.toFixed(0)}%`;
        
        // Atualiza o preenchimento do reservatório com a água acumulada (máximo de 100)
        const displayWetness = Math.min(100, person.wetness);
        wetnessIndicator.style.height = `${displayWetness}%`;
        wetnessPercentage.textContent = `${displayWetness.toFixed(0)}%`;
        
        // Altera a cor do indicador visual dependendo de quão molhada a pessoa está
        if (displayWetness > 70) {
            wetnessIndicator.style.background = 'linear-gradient(180deg, #f43f5e 0%, #ef4444 100%)'; // Vermelho
        } else if (displayWetness > 35) {
            wetnessIndicator.style.background = 'linear-gradient(180deg, #f59e0b 0%, #d97706 100%)'; // Laranja
        } else {
            wetnessIndicator.style.background = 'linear-gradient(180deg, #06b6d4 0%, #2563eb 100%)'; // Azul/Ciano
        }
    }

    // ----------------------------------------------------------------------
    // Lógica Física de Partículas e Colisões
    // ----------------------------------------------------------------------
    
    /**
     * Gera novas gotas de chuva com base na intensidade, calculando a largura
     * de nascimento dinamicamente para evitar vazios em alta velocidade ou vento.
     */
    function spawnRain(dt) {
        // Conversão simples: rainIntensity define gotas geradas por segundo
        const count = (rainIntensity * dt) / 1000;
        const integerCount = Math.floor(count);
        const remainder = count - integerCount;
        
        // Garante geração contínua baseada em frações
        let toSpawn = integerCount;
        if (Math.random() < remainder) toSpawn += 1;
        
        // A velocidade horizontal da chuva depende unicamente do vento
        const expectedVx = windSpeed;
        
        // Tempo máximo estimado de queda vertical
        const vyMin = rainFallSpeed * 0.7;
        const maxFlightTime = (canvas.height + 50) / vyMin;
        
        // Deslocamento horizontal máximo gerado pelo vento
        const maxDx = expectedVx * maxFlightTime;
        
        // Define a faixa horizontal de nascimento dinamicamente
        let minX, maxX;
        if (expectedVx < 0) {
            // Chuva se move para a esquerda: precisa de spawn extra à direita
            minX = -100;
            maxX = canvas.width - maxDx + 100; // maxDx é negativo, logo subtrair resulta em soma
        } else {
            // Chuva se move para a direita: precisa de spawn extra à esquerda
            minX = -maxDx - 100;
            maxX = canvas.width + 100;
        }
        
        for (let i = 0; i < toSpawn; i++) {
            const x = Math.random() * (maxX - minX) + minX;
            const y = -30;
            
            // Velocidade física de queda Y
            const vy = (rainFallSpeed * 0.7) + Math.random() * (rainFallSpeed * 0.6);
            
            // Velocidade horizontal inicial
            const vx = windSpeed;
            
            particles.push(new RainParticle(x, y, vx, vy));
        }
    }

    /**
     * Executa a física de movimento e detecção de colisões para todas as gotas.
     */
    function updatePhysics(dt) {
        // Suaviza a velocidade da pessoa em direção à desejada (efeito de aceleração)
        currentSpeedKmh += (targetSpeedKmh - currentSpeedKmh) * 0.08;
        
        let moveDir = 0;
        let activeSpeedKmh = currentSpeedKmh;

        if (mode === 'free') {
            if (movementMode === 'manual') {
                // Modo Manual: Movimenta apenas se a respectiva tecla de direção estiver pressionada
                const goLeft = keysPressed['ArrowLeft'] || keysPressed['a'] || keysPressed['A'];
                const goRight = keysPressed['ArrowRight'] || keysPressed['d'] || keysPressed['D'];
                
                if (goLeft && !goRight) {
                    moveDir = -1;
                } else if (goRight && !goLeft) {
                    moveDir = 1;
                } else {
                    moveDir = 0;
                    activeSpeedKmh = 0; // Se não estiver movendo, a velocidade da animação é 0
                }

                const personSpeedPhysical = (activeSpeedKmh * 0.277) * 4.5 * moveDir;
                person.x += personSpeedPhysical * dt;
            } else {
                // Modo Automático: Movimento contínuo para a direita (facingDirection sempre 1)
                moveDir = 1;
                const personSpeedPhysical = (activeSpeedKmh * 0.277) * 4.5 * moveDir;
                person.x += personSpeedPhysical * dt;
            }
            
            // Loop de tela do personagem (wrap-around)
            const margin = 100;
            if (person.x > canvas.width + margin) {
                person.x = -margin;
            } else if (person.x < -margin) {
                person.x = canvas.width + margin;
            }
        } else {
            // No modo experimento, facingDirection é 1 (andando para a direita automaticamente)
            moveDir = 1;
        }

        // Atualiza animação das pernas e direção de visão
        person.update(dt, activeSpeedKmh, moveDir);
        
        // Atualiza a posição do guarda-chuva com a nova posição, ângulo e direção
        umbrella.update(person.x, person.y, umbrellaTargetAngle, person.facingDirection);
        
        // Limite horizontal dinâmico para limpeza de partículas (depende apenas do vento)
        const expectedVx = windSpeed;
        const vyMin = rainFallSpeed * 0.7;
        const maxFlightTime = (canvas.height + 50) / vyMin;
        const maxDx = expectedVx * maxFlightTime;
        const limitX = Math.max(1000, Math.abs(maxDx) + 200);

        // A estrada tracejada fica estática na tela
        roadOffset = 0;

        // Elementos geométricos de colisão
        const umbrellaVertices = umbrella.getVertices();
        const headGeo = person.getHeadGeometry();
        const bodyGeo = person.getBodyGeometry();

        // 1. Atualizar Gotas de Chuva
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            
            // Atualiza posição da gota de chuva com vento e gravidade
            p.update(dt, windSpeed, gravity);

            // Trajetória percorrida pela gota neste frame
            const pA = { x: p.oldX, y: p.oldY };
            const pMid = { x: (p.oldX + p.x) / 2, y: (p.oldY + p.y) / 2 };
            const pB = { x: p.x, y: p.y };

            // Verifica colisão com Guarda-chuva (arestas superiores e base do triângulo)
            const uV = umbrellaVertices;
            const collidedWithUmbrella = 
                checkLineIntersection(pA, pB, uV[1], uV[0]) || // Aresta esquerda para ápice
                checkLineIntersection(pA, pB, uV[2], uV[0]) || // Aresta direita para ápice
                checkLineIntersection(pA, pB, uV[1], uV[2]) || // Aresta base
                checkCollisionPointTriangle(p.x, p.y, uV[0], uV[1], uV[2]); // Ponto final dentro

            if (collidedWithUmbrella) {
                totalBlocked++;
                // Gera partículas de faíscas/respingo brilhantes
                const splashCount = 4 + Math.floor(Math.random() * 4);
                // Determina ponto aproximado do splash
                const splashX = (p.oldY < uV[1].y && p.y > uV[1].y) ? p.oldX : p.x;
                const splashY = Math.min(p.y, Math.max(uV[0].y, uV[1].y));
                for (let k = 0; k < splashCount; k++) {
                    // Respinga principalmente para cima e para fora
                    const angleRad = (umbrellaTargetAngle * Math.PI) / 180;
                    const svx = p.vx * 0.2 + (Math.random() - 0.5) * 6 - Math.sin(angleRad) * 2;
                    const svy = -p.vy * 0.15 - Math.random() * 4 - Math.cos(angleRad) * 2;
                    splashes.push(new SplashParticle(splashX, splashY, svx, svy));
                }
                particles.splice(i, 1);
                continue;
            }

            // Verifica colisão com Cabeça (Círculo) - testando início, meio e fim do trajeto
            const collidedWithHead = 
                checkCollisionPointCircle(pA.x, pA.y, headGeo) ||
                checkCollisionPointCircle(pMid.x, pMid.y, headGeo) ||
                checkCollisionPointCircle(pB.x, pB.y, headGeo);

            if (collidedWithHead) {
                totalHit++;
                person.wetnessHead += 0.25; 
                
                // Splashes menores no choque com a cabeça
                const splashCount = 2 + Math.floor(Math.random() * 2);
                for (let k = 0; k < splashCount; k++) {
                    const svx = (Math.random() - 0.5) * 3;
                    const svy = -Math.random() * 2 - 1;
                    splashes.push(new SplashParticle(p.x, p.y, svx, svy));
                }
                particles.splice(i, 1);
                continue;
            }

            // Verifica colisão com Corpo (Retângulo) - testando início, meio e fim do trajeto
            const collidedWithBody = 
                checkCollisionPointRect(pA.x, pA.y, bodyGeo) ||
                checkCollisionPointRect(pMid.x, pMid.y, bodyGeo) ||
                checkCollisionPointRect(pB.x, pB.y, bodyGeo);

            if (collidedWithBody) {
                totalHit++;
                
                // Divisão Y para separar Tronco e Pernas
                const divisionY = person.y - 30 * person.scale;
                if (p.y < divisionY) {
                    person.wetnessBody += 0.15;
                } else {
                    person.wetnessLegs += 0.15;
                }

                // Splashes na lateral do corpo
                const splashCount = 2 + Math.floor(Math.random() * 2);
                for (let k = 0; k < splashCount; k++) {
                    const svx = (Math.random() - 0.5) * 3;
                    const svy = -Math.random() * 2 - 1;
                    splashes.push(new SplashParticle(p.x, p.y, svx, svy));
                }
                particles.splice(i, 1);
                continue;
            }

            // Verifica colisão com o Chão
            if (p.y >= groundY) {
                // Cria respingo no chão
                const splashCount = 2 + Math.floor(Math.random() * 2);
                for (let k = 0; k < splashCount; k++) {
                    const svx = (Math.random() - 0.5) * 4 + windSpeed * 0.1;
                    const svy = -Math.random() * 3 - 1;
                    splashes.push(new SplashParticle(p.x, groundY, svx, svy));
                }
                particles.splice(i, 1);
                continue;
            }

            // Remove partículas fora do limite horizontal dinâmico
            if (p.x < -limitX || p.x > canvas.width + limitX) {
                particles.splice(i, 1);
            }
        }

        // 2. Atualizar Partículas de Respingo (Splashes)
        for (let i = splashes.length - 1; i >= 0; i--) {
            const s = splashes[i];
            s.update(dt);
            if (s.life <= 0 || s.y > groundY + 10) {
                splashes.splice(i, 1);
            }
        }

        // Atualiza a umidade global do personagem (Média Ponderada)
        person.wetness = (person.wetnessHead * 0.4) + (person.wetnessBody * 0.4) + (person.wetnessLegs * 0.2);
    }

    // ----------------------------------------------------------------------
    // Renderização Visual no Canvas
    // ----------------------------------------------------------------------
    function drawSimulation() {
        // Efeito de desvanecimento sutil para criar rastro nas gotas (Motion Blur)
        ctx.fillStyle = 'rgba(7, 9, 19, 0.45)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Desenha silhuetas de prédios cyberpunk no fundo
        ctx.fillStyle = 'rgba(15, 23, 42, 0.3)';
        const numBuildings = 6;
        const bWidth = canvas.width / numBuildings;
        const heights = [180, 240, 150, 280, 200, 260];
        for (let i = 0; i < numBuildings; i++) {
            const h = heights[i % heights.length];
            const bx = i * bWidth;
            ctx.fillRect(bx + 5, groundY - h, bWidth - 10, h);
            
            ctx.fillStyle = i % 2 === 0 ? 'rgba(0, 240, 255, 0.04)' : 'rgba(124, 58, 237, 0.04)';
            for (let wy = groundY - h + 20; wy < groundY - 20; wy += 35) {
                for (let wx = bx + 15; wx < bx + bWidth - 20; wx += 25) {
                    ctx.fillRect(wx, wy, 8, 12);
                }
            }
            ctx.fillStyle = 'rgba(15, 23, 42, 0.3)';
        }

        // Desenha a Estrada / Chão neon
        ctx.strokeStyle = 'rgba(59, 130, 246, 0.4)'; // Azul
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(0, groundY);
        ctx.lineTo(canvas.width, groundY);
        ctx.stroke();

        if (mode === 'experiment') {
            // Sinalização neon das placas de distância
            ctx.fillStyle = '#c084fc';
            ctx.strokeStyle = 'rgba(124, 58, 237, 0.5)';
            ctx.lineWidth = 2;
            ctx.font = '11px Outfit, sans-serif';
            ctx.textAlign = 'center';

            const startX = 30;
            const endX = canvas.width - 30;

            // Partida
            ctx.beginPath();
            ctx.moveTo(startX, groundY);
            ctx.lineTo(startX, groundY + 12);
            ctx.stroke();
            ctx.fillText('START', startX, groundY + 25);

            // Chegada
            ctx.beginPath();
            ctx.moveTo(endX, groundY);
            ctx.lineTo(endX, groundY + 12);
            ctx.stroke();
            ctx.fillText('FINISH', endX, groundY + 25);

            // Placas intermediárias (25%, 50%, 75%)
            for (let i = 1; i <= 3; i++) {
                const fraction = i * 0.25;
                const x = startX + fraction * (endX - startX);
                const distVirtual = fraction * targetDistance;
                
                ctx.beginPath();
                ctx.moveTo(x, groundY);
                ctx.lineTo(x, groundY + 8);
                ctx.stroke();
                ctx.fillText(`${distVirtual.toFixed(0)}m`, x, groundY + 20);
            }
        } else {
            // Modo livre: Desenha as linhas tracejadas normais
            ctx.strokeStyle = 'rgba(6, 182, 212, 0.15)'; // Ciano suave
            ctx.lineWidth = 3;
            ctx.beginPath();
            const dashWidth = 40;
            const gapWidth = 40;
            
            let drawX = 0;
            while (drawX < canvas.width + 80) {
                ctx.moveTo(drawX, groundY + 12);
                ctx.lineTo(drawX + dashWidth, groundY + 12);
                drawX += dashWidth + gapWidth;
            }
            ctx.stroke();
        }

        // Desenha as gotas de chuva
        for (let p of particles) {
            p.draw(ctx);
        }

        // Desenha os estilhaços de colisão
        for (let s of splashes) {
            s.draw(ctx);
        }

        // Desenha la pessoa e o guarda-chuva
        person.draw(ctx);
        umbrella.draw(ctx);
    }

    // ----------------------------------------------------------------------
    // Loop Principal da Simulação Física
    // ----------------------------------------------------------------------
    function simulationLoop(timestamp) {
        if (!isRunning) return;

        // Calcula a variação de tempo real (delta time)
        let elapsed = timestamp - lastTime;
        lastTime = timestamp;

        // Limita o dt para evitar grandes saltos de física em travamentos de abas
        if (elapsed > 100) elapsed = 100;
        
        // Fator de escala temporal para cálculo físico consistente
        const dt = elapsed / 16.666; // 1.0 equivale a 60 FPS normais

        if (mode === 'free') {
            spawnRain(elapsed);
            updatePhysics(dt);
            drawSimulation();
        } else if (mode === 'experiment') {
            const baseSpeed = parseFloat(expSpeedInput.value);
            
            // Executa spawn e física em tempo real (1x)
            spawnRain(elapsed);
            updatePhysics(dt);

            // Distância avançada em metros neste frame
            const distanceFrame = (baseSpeed * 0.277) * (elapsed / 1000);
            experimentDistance += distanceFrame;
            experimentTime += (elapsed / 1000);

            // Controla a posição X do boneco linearmente ao longo do percurso do experimento
            const startX = 30;
            const endX = canvas.width - 30;
            person.x = startX + (experimentDistance / targetDistance) * (endX - startX);

            if (experimentDistance >= targetDistance) {
                experimentDistance = targetDistance;
                person.x = endX;
                finishExperiment();
            }

            // Atualiza a UI do Experimento
            const progressPercent = (experimentDistance / targetDistance) * 100;
            experimentProgress.style.width = `${progressPercent}%`;
            experimentDistanceText.textContent = `${Math.round(experimentDistance)}m / ${targetDistance}m`;
            
            drawSimulation();
        }

        updateDashboard();
        requestAnimationFrame(simulationLoop);
    }

    // ----------------------------------------------------------------------
    // Lógica do Experimento
    // ----------------------------------------------------------------------
    function startExperiment() {
        if (mode === 'experiment') return; // Já está rodando

        // Salva estados da simulação livre para restaurar depois
        savedFreeSpeedKmh = targetSpeedKmh;
        
        // Bloqueia sliders no modo experimento
        mode = 'experiment';
        controlSpeed.disabled = true;
        presetButtons.forEach(btn => btn.style.pointerEvents = 'none');
        expDistanceSelect.disabled = true;

        // Altera o texto e estilo do botão de experimento para servir de cancelamento
        btnRunExperiment.textContent = 'Cancelar Desafio';
        btnRunExperiment.classList.add('btn-cancel');

        // Define a velocidade do teste
        const testSpeed = parseFloat(expSpeedInput.value);
        targetSpeedKmh = testSpeed;
        currentSpeedKmh = testSpeed;

        // Reseta métricas
        totalHit = 0;
        totalBlocked = 0;
        person.wetness = 0;
        person.wetnessHead = 0;
        person.wetnessBody = 0;
        person.wetnessLegs = 0;
        particles = [];
        splashes = [];
        experimentDistance = 0;
        experimentTime = 0;
        person.x = 30; // Inicia na extrema esquerda (START)
        isTerminated = false;

        // Atualiza Labels
        updateControlLabels();
        updateDashboard();
        updateAudio();

        // Abre o overlay visual
        overlayTitle.textContent = `Experimento Científico: ${testSpeed} km/h (${targetDistance}m)`;
        overlayDescription.textContent = `Seu personagem está cruzando o percurso de ${targetDistance} metros. Veja a chuva atingindo ele pelas laterais!`;
        experimentProgress.style.width = '0%';
        experimentDistanceText.textContent = `0m / ${targetDistance}m`;
        experimentOverlay.classList.remove('hidden');

        // Garante que o loop esteja rodando
        if (!isRunning) {
            isRunning = true;
            btnPlayPause.textContent = 'Pausar';
            btnPlayPause.classList.add('btn-primary');
            btnPlayPause.classList.remove('btn-secondary');
        }
        lastTime = performance.now();
    }

    function cancelExperiment() {
        if (mode !== 'experiment') return;
        
        mode = 'free';
        
        // Restaura controles e velocidade
        controlSpeed.disabled = false;
        presetButtons.forEach(btn => btn.style.pointerEvents = 'auto');
        expDistanceSelect.disabled = false;
        
        targetSpeedKmh = savedFreeSpeedKmh;
        currentSpeedKmh = savedFreeSpeedKmh;

        // Restaura botão do experimento
        btnRunExperiment.textContent = 'Iniciar Desafio';
        btnRunExperiment.classList.remove('btn-cancel');

        // Esconde o overlay
        experimentOverlay.classList.add('hidden');
        experimentResults.classList.add('hidden');

        // Limpa tudo de volta a um estado limpo de simulação livre
        totalHit = 0;
        totalBlocked = 0;
        person.wetness = 0;
        person.wetnessHead = 0;
        person.wetnessBody = 0;
        person.wetnessLegs = 0;
        particles = [];
        splashes = [];
        person.x = canvas.width / 2;

        updateControlLabels();
        highlightClosestPreset(targetSpeedKmh);
        updateDashboard();
        updateAudio();
    }

    function finishExperiment() {
        mode = 'free';
        
        // Restaura controles e velocidade
        controlSpeed.disabled = false;
        presetButtons.forEach(btn => btn.style.pointerEvents = 'auto');
        expDistanceSelect.disabled = false;
        
        targetSpeedKmh = savedFreeSpeedKmh;
        currentSpeedKmh = savedFreeSpeedKmh;

        // Restaura botão do experimento
        btnRunExperiment.textContent = 'Iniciar Desafio';
        btnRunExperiment.classList.remove('btn-cancel');

        // Esconde o overlay
        experimentOverlay.classList.add('hidden');

        // Resultados
        const speed = parseFloat(expSpeedInput.value);
        const finalWet = Math.min(100, person.wetness);

        resSpeed.textContent = `${speed} km/h (${targetDistance}m)`;
        resTime.textContent = `${experimentTime.toFixed(1)}s`;
        resWater.textContent = `${finalWet.toFixed(0)}%`;
        experimentResults.classList.remove('hidden');

        // Salva no histórico
        saveToHistory(speed, experimentTime, finalWet, targetDistance);
        
        updateControlLabels();
        highlightClosestPreset(targetSpeedKmh);
        updateAudio();
    }

    btnRunExperiment.addEventListener('click', () => {
        if (mode === 'experiment') {
            cancelExperiment();
        } else {
            startExperiment();
        }
    });

    // ----------------------------------------------------------------------
    // Gerenciamento do Histórico de Resultados (LocalStorage)
    // ----------------------------------------------------------------------
    function saveToHistory(speed, time, wetness, distance) {
        const testResult = {
            id: Date.now(),
            speed: speed,
            time: time,
            wetness: wetness,
            distance: distance
        };

        // Carrega histórico atual
        let history = JSON.parse(localStorage.getItem('rain_sim_history')) || [];
        history.push(testResult);
        
        // Limita a 10 resultados para não poluir a tela
        if (history.length > 10) history.shift();
        
        localStorage.setItem('rain_sim_history', JSON.stringify(history));
        renderHistory();
    }

    function renderHistory() {
        let history = JSON.parse(localStorage.getItem('rain_sim_history')) || [];
        experimentHistory.innerHTML = '';

        if (history.length === 0) {
            experimentHistory.innerHTML = '<li class="history-empty">Nenhum teste realizado ainda.</li>';
            btnClearHistory.classList.add('hidden');
            return;
        }

        btnClearHistory.classList.remove('hidden');

        // Ordena do menor nível de umidade para o maior para criar um ranking!
        history.sort((a, b) => a.wetness - b.wetness);

        history.forEach((item, index) => {
            const li = document.createElement('li');
            li.className = 'history-item';
            
            // Define o rótulo do resultado (Melhor opção ganha destaque)
            const badgeText = index === 0 ? '🏆 Melhor' : `#${index + 1}`;
            const wetnessClass = item.wetness < 35 ? 'low' : '';
            const distanceText = item.distance ? ` (${item.distance}m)` : ' (100m)';

            li.innerHTML = `
                <div class="history-item-details">
                    <span class="history-item-speed">${badgeText} - ${item.speed} km/h${distanceText}</span>
                    <span class="history-item-time">Tempo: ${item.time.toFixed(1)}s</span>
                </div>
                <div class="history-item-wetness ${wetnessClass}">
                    ${item.wetness.toFixed(0)}%
                </div>
            `;
            experimentHistory.appendChild(li);
        });
    }

    btnClearHistory.addEventListener('click', () => {
        localStorage.removeItem('rain_sim_history');
        renderHistory();
    });

    // Eventos de Abertura/Fechamento do Modal Teórico
    if (btnOpenTheory && btnCloseTheory && theoryModal) {
        btnOpenTheory.addEventListener('click', () => {
            theoryModal.classList.remove('hidden');
        });

        btnCloseTheory.addEventListener('click', () => {
            theoryModal.classList.add('hidden');
        });

        theoryModal.addEventListener('click', (e) => {
            if (e.target === theoryModal) {
                theoryModal.classList.add('hidden');
            }
        });
    }

    // Inicialização da interface e carregamento do histórico
    updateControlLabels();
    renderHistory();
    
    // Inicia o Loop Principal
    requestAnimationFrame(simulationLoop);
});

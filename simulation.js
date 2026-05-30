/* ==========================================================================
   Classes e Física da Simulação - Simulador de Chuva (simulation.js)
   Este arquivo contém o motor de física de partículas, renderização no Canvas
   e algoritmos precisos de colisão geométrica.
   ========================================================================== */

/**
 * Calcula a cor baseada no nível de umidade para o mapa de calor.
 * @param {number} value Nível de umidade (0 a 100)
 * @param {boolean} isStrokeVal Se a cor é para o traço ou preenchimento
 */
function getHeatmapColor(value, isStrokeVal = true) {
    const val = Math.min(100, Math.max(0, value));
    let r1, g1, b1;
    if (isStrokeVal) {
        r1 = 248; g1 = 250; b1 = 252; // #f8fafc (Seco)
    } else {
        r1 = 30;  g1 = 41;  b1 = 59;  // #1e293b (Seco)
    }
    
    const rMid = 0;   const gMid = 240; const bMid = 255;  // #00f0ff (Ciano)
    const rMax = 244; const gMax = 63;  const bMax = 94;   // #f43f5e (Vermelho)
    
    let r, g, b;
    if (val < 50) {
        const t = val / 50;
        r = Math.round(r1 + (rMid - r1) * t);
        g = Math.round(g1 + (gMid - g1) * t);
        b = Math.round(b1 + (bMid - b1) * t);
    } else {
        const t = (val - 50) / 50;
        r = Math.round(rMid + (rMax - rMid) * t);
        g = Math.round(gMid + (gMax - gMid) * t);
        b = Math.round(bMid + (bMax - bMid) * t);
    }
    
    return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Representa uma única gota de chuva na simulação.
 */
class RainParticle {
    constructor(x, y, vx, vy) {
        this.x = x;
        this.y = y;
        this.oldX = x;
        this.oldY = y;
        this.vx = vx; // Velocidade horizontal (afetada pelo vento e velocidade relativa)
        this.vy = vy; // Velocidade vertical (afetada pela gravidade)
        this.length = 12 + Math.random() * 8; // Comprimento visual da gota
        this.width = 1.5 + Math.random() * 1;  // Espessura
        this.alpha = 0.3 + Math.random() * 0.4; // Transparência
    }

    update(dt, windSpeed, gravity) {
        // Salva a posição antiga antes de atualizar
        this.oldX = this.x;
        this.oldY = this.y;

        // A velocidade horizontal final que vemos no canvas depende unicamente do vento
        const targetVx = windSpeed;
        
        // Suaviza a velocidade horizontal em direção à velocidade resultante
        this.vx += (targetVx - this.vx) * 0.1;
        this.vy += gravity * dt * 0.1; // Efeito gravitacional simples

        // Limita a velocidade vertical (velocidade terminal da gota)
        if (this.vy > 25) this.vy = 25;

        // Atualiza a posição espacial
        this.x += this.vx * dt;
        this.y += this.vy * dt;
    }

    draw(ctx) {
        ctx.beginPath();
        ctx.strokeStyle = `rgba(0, 240, 255, ${this.alpha})`;
        ctx.lineWidth = this.width;

        // Desenha a gota de chuva alinhada com seu vetor velocidade
        // O ponto (this.x, this.y) representa a ponta física da gota, o rastro vai para trás
        const angle = Math.atan2(this.vy, this.vx);
        const xStart = this.x - Math.cos(angle) * this.length;
        const yStart = this.y - Math.sin(angle) * this.length;

        ctx.moveTo(xStart, yStart);
        ctx.lineTo(this.x, this.y);
        ctx.stroke();
    }
}

/**
 * Representa uma partícula de respingo (splash) gerada ao colidir.
 */
class SplashParticle {
    constructor(x, y, vx, vy) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.radius = 1 + Math.random() * 2;
        this.maxLife = 15 + Math.random() * 15;
        this.life = this.maxLife;
    }

    update(dt) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.vy += 0.5 * dt; // Gravidade atuando nos estilhaços
        this.life -= dt;
    }

    draw(ctx) {
        if (this.life <= 0) return;
        const alpha = this.life / this.maxLife;
        ctx.beginPath();
        ctx.fillStyle = `rgba(0, 240, 255, ${alpha * 0.8})`;
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
    }
}

/**
 * Representa o Guarda-Chuva.
 */
class Umbrella {
    constructor(radius = 55, stickLength = 75, scale = 1.5) {
        this.scale = scale; // Fator de escala
        this.radius = radius * this.scale; // Raio horizontal da cúpula escalado
        this.stickLength = stickLength * this.scale; // Comprimento da haste escalado
        this.angle = 0; // Ângulo de inclinação em graus
        
        // Coordenadas calculadas
        this.handX = 0;
        this.handY = 0;
        this.topStickX = 0;
        this.topStickY = 0;
        
        // Vértices do triângulo da cúpula
        this.v1 = { x: 0, y: 0 }; // Ápice (topo)
        this.v2 = { x: 0, y: 0 }; // Extremidade esquerda
        this.v3 = { x: 0, y: 0 }; // Extremidade direita
    }

    /**
     * Atualiza as coordenadas do guarda-chuva com base na posição da pessoa, ângulo e direção de visão.
     */
    update(personX, personY, targetAngleDegrees, facingDirection = 1) {
        this.angle = targetAngleDegrees;
        const rad = (this.angle * Math.PI) / 180;

        // Ponto da mão da pessoa que segura o guarda-chuva
        this.handX = personX + 12 * this.scale * facingDirection;
        this.handY = personY - 60 * this.scale;

        // O topo da haste (base de rotação da cúpula)
        // A haste se projeta a partir da mão de acordo com o ângulo
        this.topStickX = this.handX + Math.sin(rad) * this.stickLength;
        this.topStickY = this.handY - Math.cos(rad) * this.stickLength;

        // Coordenadas locais da cúpula sem rotação (em relação ao topo da haste como pivot)
        // Vértice 1 (Ápice superior): ~22px acima da haste (escalado)
        // Vértice 2 (Esquerda): radius à esquerda (já escalado no construtor)
        // Vértice 3 (Direita): radius à direita (já escalado no construtor)
        const localV1 = { x: 0, y: -22 * this.scale };
        const localV2 = { x: -this.radius, y: 5 * this.scale };
        const localV3 = { x: this.radius, y: 5 * this.scale };

        // Aplica a matrix de rotação em torno do pivot (topStickX, topStickY)
        const rotate = (p) => {
            return {
                x: this.topStickX + p.x * Math.cos(rad) - p.y * Math.sin(rad),
                y: this.topStickY + p.x * Math.sin(rad) + p.y * Math.cos(rad)
            };
        };

        this.v1 = rotate(localV1);
        this.v2 = rotate(localV2);
        this.v3 = rotate(localV3);
    }

    /**
     * Desenha o guarda-chuva.
     */
    draw(ctx) {
        const scale = this.scale;
        // 1. Desenha a Haste
        ctx.beginPath();
        ctx.strokeStyle = '#94a3b8'; // Cinza metálico
        ctx.lineWidth = 4 * scale;
        ctx.lineCap = 'round';
        ctx.moveTo(this.handX, this.handY);
        ctx.lineTo(this.topStickX, this.topStickY);
        ctx.stroke();

        // Pequeno cabo em U no final da haste (mão)
        ctx.beginPath();
        ctx.arc(this.handX - 2 * scale, this.handY + 2 * scale, 4 * scale, 0, Math.PI);
        ctx.stroke();

        // 2. Desenha a cúpula do guarda-chuva (Triângulo)
        ctx.beginPath();
        ctx.moveTo(this.v1.x, this.v1.y);
        ctx.lineTo(this.v2.x, this.v2.y);
        ctx.lineTo(this.v3.x, this.v3.y);
        ctx.closePath();

        // Gradiente brilhante para preencher a cúpula
        const grad = ctx.createLinearGradient(this.v1.x, this.v1.y, (this.v2.x + this.v3.x)/2, (this.v2.y + this.v3.y)/2);
        grad.addColorStop(0, 'rgba(0, 240, 255, 0.7)'); // Ciano brilhante no topo
        grad.addColorStop(1, 'rgba(37, 99, 235, 0.4)');  // Azul semi-transparente na borda

        ctx.fillStyle = grad;
        ctx.fill();

        // Borda neon da cúpula
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 3 * scale;
        ctx.shadowBlur = 10 * scale;
        ctx.shadowColor = 'rgba(0, 240, 255, 0.6)';
        ctx.stroke();
        
        // Remove o brilho de sombra para os próximos desenhos
        ctx.shadowBlur = 0;

        // Desenha pequenas hastes de reforço internas (detalhe premium)
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1.5 * scale;
        ctx.moveTo(this.topStickX, this.topStickY);
        ctx.lineTo(this.v2.x, this.v2.y);
        ctx.moveTo(this.topStickX, this.topStickY);
        ctx.lineTo(this.v3.x, this.v3.y);
        ctx.moveTo(this.topStickX, this.topStickY);
        ctx.lineTo(this.v1.x, this.v1.y);
        ctx.stroke();
    }

    /**
     * Retorna os vértices para detecção de colisão.
     */
    getVertices() {
        return [this.v1, this.v2, this.v3];
    }
}

/**
 * Representa a Pessoa na simulação.
 */
class Person {
    constructor(x, y, scale = 1.5) {
        this.x = x;
        this.y = y; // Y é a linha do chão
        this.scale = scale; // Fator global de escala proporcional
        
        this.speed = 4; // Velocidade de movimento atual em km/h
        this.wetness = 0; // Reservatório de água acumulada (0 a 100)
        this.facingDirection = 1; // 1 para direita, -1 para esquerda
        
        // Propriedades de umidade segmentada para o mapa de calor
        this.wetnessHead = 0;
        this.wetnessBody = 0;
        this.wetnessLegs = 0;
        
        // Dimensões do corpo escaladas proporcionalmente
        this.headRadius = 15 * this.scale;
        this.bodyWidth = 20 * this.scale;
        this.bodyHeight = 75 * this.scale;
        
        // Parâmetros de animação para as pernas
        this.walkCycle = 0;
    }

    /**
     * Atualiza o ciclo de caminhada/corrida e a direção do movimento.
     */
    update(dt, currentSpeedKmh, moveDirection = 1) {
        this.speed = currentSpeedKmh;
        if (moveDirection !== 0) {
            this.facingDirection = moveDirection;
        }
        // A velocidade de animação das pernas depende da velocidade da pessoa
        if (this.speed > 0.1) {
            this.walkCycle += (this.speed * 0.1) * dt;
        } else {
            this.walkCycle = 0; // Reseta se estiver parado
        }
    }

    /**
     * Desenha a pessoa (boneco articulado geométrico elegante).
     */
    draw(ctx) {
        const scale = this.scale;
        const bodyTopY = this.y - 105 * scale;
        const headY = bodyTopY - this.headRadius; // Equivalente a y - 120 * scale
        
        // Desenha as pernas de forma articulada (animação de caminhada)
        const maxLegSwing = Math.min(0.6, this.speed * 0.04); // Amplitude da passada baseada na velocidade
        const leftLegAngle = Math.sin(this.walkCycle) * maxLegSwing;
        const rightLegAngle = -Math.sin(this.walkCycle) * maxLegSwing;

        ctx.strokeStyle = getHeatmapColor(this.wetnessLegs, true); // Cor das pernas baseada no heatmap
        ctx.lineWidth = 5 * scale; // Largura do traço escalada
        ctx.lineCap = 'round';

        // Perna Esquerda (X oscila proporcionalmente à direção em que está olhando)
        const leftKneeX = this.x - 6 * scale * this.facingDirection + Math.sin(leftLegAngle) * 15 * scale * this.facingDirection;
        const leftKneeY = this.y - 18 * scale + Math.cos(leftLegAngle) * 15 * scale;
        const leftFootX = leftKneeX + Math.sin(leftLegAngle * 1.5) * 15 * scale * this.facingDirection;
        const leftFootY = this.y;
        
        ctx.beginPath();
        ctx.moveTo(this.x - 6 * scale * this.facingDirection, this.y - 29 * scale); // Quadril esquerdo
        ctx.lineTo(leftKneeX, leftKneeY);
        ctx.lineTo(leftFootX, leftFootY);
        ctx.stroke();

        // Perna Direita
        const rightKneeX = this.x + 6 * scale * this.facingDirection + Math.sin(rightLegAngle) * 15 * scale * this.facingDirection;
        const rightKneeY = this.y - 18 * scale + Math.cos(rightLegAngle) * 15 * scale;
        const rightFootX = rightKneeX + Math.sin(rightLegAngle * 1.5) * 15 * scale * this.facingDirection;
        const rightFootY = this.y;

        ctx.beginPath();
        ctx.moveTo(this.x + 6 * scale * this.facingDirection, this.y - 29 * scale); // Quadril direito
        ctx.lineTo(rightKneeX, rightKneeY);
        ctx.lineTo(rightFootX, rightFootY);
        ctx.stroke();

        // Tronco/Corpo (Retângulo)
        ctx.fillStyle = getHeatmapColor(this.wetnessBody, false); // Preenchimento dinâmico do tronco
        ctx.strokeStyle = getHeatmapColor(this.wetnessBody, true); // Contorno dinâmico do tronco
        ctx.lineWidth = 3 * scale;
        
        // Desenha retângulo com cantos levemente arredondados
        const bodyX = this.x - this.bodyWidth / 2;
        ctx.beginPath();
        ctx.roundRect(bodyX, bodyTopY, this.bodyWidth, this.bodyHeight, 6 * scale);
        ctx.fill();
        ctx.stroke();

        // Cabeça (Círculo)
        ctx.beginPath();
        ctx.fillStyle = '#0f172a';
        ctx.strokeStyle = getHeatmapColor(this.wetnessHead, true); // Contorno dinâmico da cabeça
        ctx.arc(this.x, headY, this.headRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Olho (pequeno ponto brilhante indicando a direção)
        // Desloca o olho para a esquerda ou direita dependendo de facingDirection
        ctx.beginPath();
        ctx.fillStyle = '#00f0ff';
        ctx.arc(this.x + 7 * scale * this.facingDirection, headY - 2 * scale, 2.5 * scale, 0, Math.PI * 2);
        ctx.fill();

        // Desenha Braço Traseiro (oscilando)
        const leftArmAngle = Math.sin(this.walkCycle + Math.PI) * maxLegSwing * 0.8;
        ctx.beginPath();
        ctx.strokeStyle = getHeatmapColor(this.wetnessBody, true); // Cor do braço baseada no tronco
        ctx.lineWidth = 4 * scale;
        ctx.moveTo(this.x - 8 * scale * this.facingDirection, bodyTopY + 10 * scale);
        ctx.lineTo(this.x - 16 * scale * this.facingDirection + Math.sin(leftArmAngle) * 20 * scale * this.facingDirection, bodyTopY + 25 * scale + Math.cos(leftArmAngle) * 15 * scale);
        ctx.stroke();

        // Desenha Braço Frontal (segurando o guarda-chuva)
        // O braço frontal estende-se em direção à haste do guarda-chuva
        ctx.beginPath();
        ctx.strokeStyle = getHeatmapColor(this.wetnessBody, true); // Cor do braço baseada no tronco
        ctx.moveTo(this.x + 8 * scale * this.facingDirection, bodyTopY + 12 * scale);
        ctx.lineTo(this.x + 12 * scale * this.facingDirection, this.y - 60 * scale); // Conecta na mão (handX/handY do guarda-chuva)
        ctx.stroke();
    }

    /**
     * Retorna a geometria da cabeça para colisão.
     */
    getHeadGeometry() {
        return {
            x: this.x,
            y: this.y - 120 * this.scale,
            radius: this.headRadius
        };
    }

    /**
     * Retorna a geometria do corpo para colisão.
     */
    getBodyGeometry() {
        return {
            x: this.x - this.bodyWidth / 2,
            y: this.y - 105 * this.scale,
            width: this.bodyWidth,
            height: 105 * this.scale // Cobre todo o tronco e as pernas até a linha do chão (pé)
        };
    }
}

/**
 * ==========================================================================
 * Funções Físicas de Colisão Matemática Exata
 * ==========================================================================
 */

/**
 * Verifica se um ponto P(x, y) colide com um círculo (cabeça).
 */
function checkCollisionPointCircle(px, py, circle) {
    const dx = px - circle.x;
    const dy = py - circle.y;
    const distanceSq = dx * dx + dy * dy;
    return distanceSq <= circle.radius * circle.radius;
}

/**
 * Verifica se um ponto P(x, y) colide com um retângulo (corpo).
 */
function checkCollisionPointRect(px, py, rect) {
    return px >= rect.x && px <= rect.x + rect.width &&
           py >= rect.y && py <= rect.y + rect.height;
}

/**
 * Verifica se um ponto P(x, y) está dentro de um triângulo ABC usando Coordenadas Baricêntricas.
 * Este é o método mais eficiente e preciso para colidir com o guarda-chuva triangular.
 */
function checkCollisionPointTriangle(px, py, v1, v2, v3) {
    const d1 = sign(px, py, v1, v2);
    const d2 = sign(px, py, v2, v3);
    const d3 = sign(px, py, v3, v1);

    const has_neg = (d1 < 0) || (d2 < 0) || (d3 < 0);
    const has_pos = (d1 > 0) || (d2 > 0) || (d3 > 0);

    // O ponto está dentro se não houver sinais opostos (todos positivos ou todos negativos)
    return !(has_neg && has_pos);
}

function sign(p1x, p1y, p2, p3) {
    return (p1x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1y - p3.y);
}

/**
 * Verifica se dois segmentos de reta AB e CD se interceptam no espaço 2D.
 * Útil para detectar colisões contínuas e evitar tunelamento físico (bullet-through-paper).
 */
function checkLineIntersection(a, b, c, d) {
    function ccw(p1, p2, p3) {
        return (p3.y - p1.y) * (p2.x - p1.x) > (p2.y - p1.y) * (p3.x - p1.x);
    }
    return (ccw(a, c, d) !== ccw(b, c, d)) && (ccw(a, b, c) !== ccw(a, b, d));
}

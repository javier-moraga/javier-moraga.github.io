(function(){'use strict';
const controllerKey=Symbol.for('portfolio.h2.neural.controller');
function boot(){
const canvas=document.getElementById('neuro-canvas');
if(!canvas || canvas[controllerKey] || !canvas.getContext || !canvas.getContext('2d')) return;
let targetMouseX = 0, targetMouseY = 0;
function onPointerMove(e) {
    targetMouseX = (e.clientX / window.innerWidth - 0.5) * 2;
    targetMouseY = (e.clientY / window.innerHeight - 0.5) * 2;
}
window.addEventListener('mousemove', onPointerMove, { passive: true });


function initNeural(canvas) {
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frameId = null;
    let motionStopped = false;
    let disposed = false;
    const ctx = canvas.getContext('2d');
    let W, H, cx, cy, R;
    let neurons = [];
    let pulses  = [];
    let time = 0, mouseX = 0, mouseY = 0, rotY = 0;
    
    let targetOpacity = 0.85, currentOpacity = 0.85;
    const onScroll = function(){
      var maxScroll = document.body.scrollHeight - window.innerHeight;
      var p = maxScroll > 0 ? window.scrollY / maxScroll : 0;
      targetOpacity = p < 0.08 ? 0.85
                    : p < 0.3  ? 0.85 - (p - 0.08) / 0.22 * 0.55
                    : 0.30;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    let systemReady = true;
    let hasAwakened = false;

    const C_BG   = [7, 7, 12];      
    const C_NET  = [0, 90, 100];    
    const C_FIRE = [0, 255, 210];   
    const C_CORE = [220, 255, 250]; 

    function lerp(a, b, t) { return a + (b - a) * t; }

    function createEvenVolumePoints(numPoints, radius) {
        const points = [];
        let attempts = 0;
        const minDistance = radius * 0.35; 
        while (points.length < numPoints && attempts < 2000) {
            attempts++;
            const u = Math.random(), v = Math.random(), w = Math.random();
            const th = 2 * Math.PI * u;
            const ph = Math.acos(2 * v - 1);
            const rad = radius * (0.1 + 0.9 * Math.cbrt(w)); 
            const p = {
                x: rad * Math.sin(ph) * Math.cos(th),
                y: rad * Math.sin(ph) * Math.sin(th),
                z: rad * Math.cos(ph)
            };

            let valid = true;
            for (let pt of points) {
                const dist = Math.sqrt((p.x - pt.x)**2 + (p.y - pt.y)**2 + (p.z - pt.z)**2);
                if (dist < minDistance) {
                    valid = false;
                    break;
                }
            }
            if (valid) {
                points.push(p);
                attempts = 0; 
            }
        }
        while (points.length < numPoints) {
            const u = Math.random(), v = Math.random(), w = Math.random();
            const th = 2 * Math.PI * u;
            const ph = Math.acos(2 * v - 1);
            const rad = radius * Math.cbrt(w);
            points.push({
                x: rad * Math.sin(ph) * Math.cos(th),
                y: rad * Math.sin(ph) * Math.sin(th),
                z: rad * Math.cos(ph)
            });
        }
        return points;
    }

    function projPt(x, y, z) {
        const cRotY = rotY + mouseX * 0.25; 
        const cY = Math.cos(cRotY), sY = Math.sin(cRotY);
        const cRotX = Math.sin(time * 0.03) * 0.05 - mouseY * 0.25;
        const cX = Math.cos(cRotX), sX = Math.sin(cRotX);

        const x1 = x * cY - z * sY, z1 = x * sY + z * cY;
        const y1 = y * cX - z1 * sX, z2 = y * sX + z1 * cX;
        const f = 1 + z2 / (R * 3.5); 
        return { sx: cx + x1 * f, sy: cy + y1 * f, dz: z2 };
    }

    function getBezier3D(p0, p1, p2, p3, t) {
        const mt = 1 - t;
        return {
            x: mt*mt*mt*p0.x + 3*mt*mt*t*p1.x + 3*mt*t*t*p2.x + t*t*t*p3.x,
            y: mt*mt*mt*p0.y + 3*mt*mt*t*p1.y + 3*mt*t*t*p2.y + t*t*t*p3.y,
            z: mt*mt*mt*p0.z + 3*mt*mt*t*p1.z + 3*mt*t*t*p2.z + t*t*t*p3.z
        };
    }

    function getBezier2D(p0, p1, p2, p3, t) {
        const mt = 1 - t;
        return {
            x: mt*mt*mt*p0.x + 3*mt*mt*t*p1.x + 3*mt*t*t*p2.x + t*t*t*p3.x,
            y: mt*mt*mt*p0.y + 3*mt*mt*t*p1.y + 3*mt*t*t*p2.y + t*t*t*p3.y
        };
    }

    function distToCenter(px, py) {
        return Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
    }
    function edgePoint(px, py) {
        const dx = px - cx, dy = py - cy;
        const dist = Math.sqrt(dx*dx + dy*dy) || 1;
        return { x: cx + (dx/dist)*R, y: cy + (dy/dist)*R };
    }

    function resize() {
        W = canvas.width  = window.innerWidth;
        H = canvas.height = window.innerHeight;
        cx = W / 2; cy = H / 2;
        R  = Math.min(W, H) * 0.42; 
        build();
    }

    function build() {
        neurons = []; pulses = [];
        const N = Math.min(65, Math.max(35, Math.floor(W / 35))); 

        const positions = createEvenVolumePoints(N, R);

        for (let i = 0; i < N; i++) {
            const pos = positions[i];
            neurons.push({
                x: pos.x, y: pos.y, z: pos.z,
                somaR: (1.2 + Math.random() * 1.8),
                energy: 0,       
                targetEnergy: 0, 
                charge: 0, 
                refractory: 0, 
                pulsePhase: Math.random() * Math.PI * 2, 
                axons: []
            });
        }

        neurons.forEach((n, i) => {
            const relations = neurons.map((m, j) => {
                if (j === i) return { j, d: Infinity, dot: 0 };
                const dx = m.x - n.x, dy = m.y - n.y, dz = m.z - n.z;
                const d = Math.sqrt(dx*dx + dy*dy + dz*dz);
                const dot = (n.x*m.x + n.y*m.y + n.z*m.z) / (R*R); 
                return { j, d, dot };
            });

            relations.sort((a, b) => a.d - b.d);
            const targets = [];
            const numLocal = 2 + Math.floor(Math.random() * 2);
            for(let k=0; k<numLocal; k++) {
                if (relations[k].d < R * 1.5) targets.push(relations[k].j);
            }

            const opposites = relations.filter(r => r.dot < -0.15 && r.d < R * 2.2); 
            if(opposites.length > 0 && Math.random() > 0.4) {
                targets.push(opposites[Math.floor(Math.random() * opposites.length)].j);
            }

            targets.forEach(targetIdx => {
                const target = neurons[targetIdx];
                const dx = target.x - n.x, dy = target.y - n.y, dz = target.z - n.z;
                const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
                const curveSpread = dist * 0.35; 
                n.axons.push({
                    to: targetIdx,
                    c1: {
                        x: n.x + dx*0.33 + (Math.random()-0.5)*curveSpread, 
                        y: n.y + dy*0.33 + (Math.random()-0.5)*curveSpread, 
                        z: n.z + dz*0.33 + (Math.random()-0.5)*curveSpread
                    },
                    c2: {
                        x: n.x + dx*0.66 + (Math.random()-0.5)*curveSpread, 
                        y: n.y + dy*0.66 + (Math.random()-0.5)*curveSpread, 
                        z: n.z + dz*0.66 + (Math.random()-0.5)*curveSpread
                    },
                    pathEnergy: 0 
                });
            });
        });
    }

    function fireNeuron(i, force = false) {
        const n = neurons[i];
        if (!force && n.refractory > 0) return; 
        n.targetEnergy = 1.0; 
        n.charge = 0;         
        n.refractory = 4.0;   
        n.axons.forEach((ax, axIdx) => {
            pulses.push({
                from: i, to: ax.to, axIdx,
                progress: 0,
                speed: 0.0012 + Math.random() * 0.001, 
                size: 1.2 + Math.random() * 1.5
            });
        });
    }

    function update() {
        frameId = null;
        if (disposed) return;
        if (motionPreference.matches) { motionStopped=true; frameId=null; ctx.clearRect(0,0,W,H); return; }
        motionStopped=false;
        currentOpacity = lerp(currentOpacity, targetOpacity, 0.022);
        canvas.style.opacity = currentOpacity.toFixed(3);

        mouseX = lerp(mouseX, targetMouseX, 0.02);
        mouseY = lerp(mouseY, targetMouseY, 0.02);

        time += 0.005; 
        rotY = time * 0.05; 

        if (systemReady && !hasAwakened) {
            const seedCount = Math.max(1, Math.floor(neurons.length * 0.05));
            for (let k = 0; k < seedCount; k++) {
                const seedIndex = Math.floor(Math.random() * neurons.length);
                neurons[seedIndex].charge = 1.0; 
            }
            hasAwakened = true;
        }

        if (systemReady) {
            neurons.forEach((n, i) => {
                if (n.refractory <= 0 && n.targetEnergy <= 0.1) {
                    n.charge += 0.0004; 
                    if (n.charge >= 1.0) {
                        fireNeuron(i, true);
                    }
                }
            });
        }

        neurons.forEach(n => {
            n.energy = lerp(n.energy, n.targetEnergy, 0.05);

            if (n.targetEnergy > 0) n.targetEnergy -= 0.005; 
            if (n.targetEnergy < 0) n.targetEnergy = 0;
            if (n.refractory > 0) n.refractory -= 0.01;
            n.pr = projPt(n.x, n.y, n.z);
            n.depth = Math.max(0.05, (n.pr.dz / R + 1) * 0.5); 
            n.axons.forEach(ax => {
                if (ax.pathEnergy > 0) ax.pathEnergy -= 0.005;
                if (ax.pathEnergy < 0) ax.pathEnergy = 0;
            });
        });

        for (let i = pulses.length - 1; i >= 0; i--) {
            let p = pulses[i];
            p.progress += p.speed;
            const n = neurons[p.from];
            if(n) n.axons[p.axIdx].pathEnergy = Math.max(n.axons[p.axIdx].pathEnergy, p.progress);
            if (p.progress >= 1.0) {
                const target = neurons[p.to];
                target.charge += 0.35; 
                target.targetEnergy = Math.max(target.targetEnergy, 0.5); 
                if (target.charge >= 1.0) {
                    fireNeuron(p.to);
                }
                pulses.splice(i, 1);
            }
        }

        if (currentOpacity < 0.01) {
            frameId = requestAnimationFrame(update);
            return;
        }

        ctx.clearRect(0, 0, W, H);

        const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.6);
        bg.addColorStop(0, '#090a10');
        bg.addColorStop(0.7, '#07070c');
        bg.addColorStop(1, '#07070c');
        ctx.fillStyle = bg; 
        ctx.fillRect(0, 0, W, H);

        ctx.globalCompositeOperation = 'screen'; 
        const edgeSparks = [];

        ctx.lineJoin = 'round';
        neurons.forEach(n => {
            n.axons.forEach(ax => {
                const target = neurons[ax.to];
                const pr1 = projPt(ax.c1.x, ax.c1.y, ax.c1.z);
                const pr2 = projPt(ax.c2.x, ax.c2.y, ax.c2.z);

                const avgDepth = (n.depth + target.depth) * 0.5;
                const cableEnergy = Math.max(n.energy * 0.3, target.energy * 0.3, ax.pathEnergy * 0.5); 
                const alpha = (0.03 + avgDepth * 0.08) + (cableEnergy * 0.35); 
                if(alpha < 0.005) return;

                const r = lerp(C_NET[0], C_FIRE[0], cableEnergy);
                const g = lerp(C_NET[1], C_FIRE[1], cableEnergy);
                const b = lerp(C_NET[2], C_FIRE[2], cableEnergy);

                ctx.beginPath();
                ctx.moveTo(n.pr.sx, n.pr.sy);
                ctx.bezierCurveTo(pr1.sx, pr1.sy, pr2.sx, pr2.sy, target.pr.sx, target.pr.sy);
                ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
                ctx.lineWidth = 0.4 + avgDepth * 1.0 + cableEnergy * 1.5;
                ctx.stroke();

                for (let st = 0; st <= 1; st += 0.15) {
                    const pt = getBezier2D(
                        {x: n.pr.sx, y: n.pr.sy}, 
                        {x: pr1.sx, y: pr1.sy}, 
                        {x: pr2.sx, y: pr2.sy}, 
                        {x: target.pr.sx, y: target.pr.sy}, 
                        st
                    );
                    const dd = distToCenter(pt.x, pt.y);
                    if (dd > R * 0.88 && dd < R * 1.25) {
                        const proximity = 1 - Math.abs(dd - R) / (R * 0.15);
                        if (proximity > 0) {
                            edgeSparks.push({
                                x: pt.x, y: pt.y,
                                r: r|0, g: g|0, b: b|0,
                                intensity: proximity * alpha * 1.5 * (0.3 + Math.random() * 0.7),
                                size: (0.4 + avgDepth + cableEnergy + proximity * 3) * (0.5 + Math.random() * 1.0)
                            });
                        }
                    }
                }
            });
        });

        pulses.forEach(p => {
            const n = neurons[p.from];
            const target = neurons[p.to];
            const ax = n.axons[p.axIdx];
            const pos3D = getBezier3D(n, ax.c1, ax.c2, target, p.progress);
            const pos2D = projPt(pos3D.x, pos3D.y, pos3D.z);
            const pDepth = Math.max(0.1, (pos2D.dz / R + 1) * 0.5);

            const glowR = p.size * 3.5 * pDepth;
            const pg = ctx.createRadialGradient(pos2D.sx, pos2D.sy, 0, pos2D.sx, pos2D.sy, glowR);
            pg.addColorStop(0, `rgba(255, 255, 255, ${(0.9 * pDepth).toFixed(2)})`);
            pg.addColorStop(0.4, `rgba(${C_FIRE[0]}, ${C_FIRE[1]}, ${C_FIRE[2]}, ${(0.5 * pDepth).toFixed(2)})`);
            pg.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.beginPath(); ctx.arc(pos2D.sx, pos2D.sy, glowR, 0, Math.PI*2);
            ctx.fillStyle = pg; ctx.fill();

            const trail3D = getBezier3D(n, ax.c1, ax.c2, target, Math.max(0, p.progress - 0.12));
            const trail2D = projPt(trail3D.x, trail3D.y, trail3D.z);

            const grad = ctx.createLinearGradient(trail2D.sx, trail2D.sy, pos2D.sx, pos2D.sy);
            grad.addColorStop(0, `rgba(${C_FIRE[0]}, ${C_FIRE[1]}, ${C_FIRE[2]}, 0)`);
            grad.addColorStop(1, `rgba(${C_FIRE[0]}, ${C_FIRE[1]}, ${C_FIRE[2]}, ${(0.8 * pDepth).toFixed(2)})`);
            ctx.beginPath();
            ctx.moveTo(trail2D.sx, trail2D.sy);
            ctx.lineTo(pos2D.sx, pos2D.sy);
            ctx.strokeStyle = grad;
            ctx.lineWidth = p.size * pDepth * 1.5;
            ctx.lineCap = 'round';
            ctx.stroke();

            const pulseDist = distToCenter(pos2D.sx, pos2D.sy);
            if (pulseDist > R * 0.88) {
                const proximity = Math.max(0, Math.min(1, (pulseDist - R * 0.88) / (R * 0.2)));
                const ep = edgePoint(pos2D.sx, pos2D.sy);
                edgeSparks.push({
                    x: ep.x, y: ep.y,
                    r: C_FIRE[0], g: C_FIRE[1], b: C_FIRE[2],
                    intensity: proximity * 1.2 * (0.3 + Math.random() * 0.7),
                    size: (p.size * 3.5 + proximity * 6) * (0.5 + Math.random() * 1.0)
                });
            }
        });

        const sorted = neurons.slice().sort((a, b) => a.pr.dz - b.pr.dz);
        sorted.forEach(n => {
            const d = n.depth;
            const size = n.somaR * d * 2.0; 
            if (size < 0.5) return;

            const breathe = 1 + Math.sin(time * 5 + n.pulsePhase) * 0.15;
            const visualEnergy = Math.max(n.charge * 0.6, n.energy); 
            const cr = Math.round(lerp(C_NET[0] + 50, C_CORE[0], visualEnergy));
            const cg = Math.round(lerp(C_NET[1] + 50, C_CORE[1], visualEnergy));
            const cb = Math.round(lerp(C_NET[2] + 50, C_CORE[2], visualEnergy));

            ctx.beginPath(); ctx.arc(n.pr.sx, n.pr.sy, size * 2.5 * breathe, 0, Math.PI*2);
            ctx.fillStyle = `rgba(${C_NET[0]}, ${C_NET[1]}, ${C_NET[2]}, ${(0.1 * d).toFixed(2)})`;
            ctx.fill();

            const sg = ctx.createRadialGradient(n.pr.sx - size*0.25, n.pr.sy - size*0.25, size*0.05, n.pr.sx, n.pr.sy, size);
            sg.addColorStop(0, `rgba(255,255,255,${Math.min(0.95, (0.4 + visualEnergy) * d).toFixed(3)})`);
            sg.addColorStop(0.5, `rgba(${cr}, ${cg}, ${cb}, ${((0.4 + visualEnergy * 0.6) * d).toFixed(3)})`);
            sg.addColorStop(1, `rgba(${Math.max(0, cr - 40)}, ${Math.max(0, cg - 40)}, ${Math.max(0, cb - 40)}, ${((0.2 + visualEnergy * 0.3) * d).toFixed(3)})`);
            ctx.beginPath(); ctx.arc(n.pr.sx, n.pr.sy, Math.max(1, size), 0, Math.PI * 2);
            ctx.fillStyle = sg; ctx.fill();
            ctx.strokeStyle = `rgba(${cr}, ${cg}, ${cb}, ${(0.8 * d).toFixed(3)})`;
            ctx.lineWidth = 1.0 * d; 
            ctx.stroke();

            if (n.energy > 0.05) {
                const fireGlow = ctx.createRadialGradient(n.pr.sx, n.pr.sy, size, n.pr.sx, n.pr.sy, size * (3 + n.energy*2.5));
                fireGlow.addColorStop(0, `rgba(${C_FIRE[0]}, ${C_FIRE[1]}, ${C_FIRE[2]}, ${(n.energy * 0.7 * d).toFixed(2)})`);
                fireGlow.addColorStop(1, 'rgba(0,0,0,0)');
                ctx.beginPath(); ctx.arc(n.pr.sx, n.pr.sy, size * 5.5, 0, Math.PI*2);
                ctx.fillStyle = fireGlow; ctx.fill();
            }

            const somaDist = distToCenter(n.pr.sx, n.pr.sy);
            if (somaDist + size > R * 0.85) {
                const proximity = Math.max(0, Math.min(1, (somaDist + size - R * 0.85) / (R * 0.3)));
                const ep = edgePoint(n.pr.sx, n.pr.sy);
                edgeSparks.push({
                    x: ep.x, y: ep.y,
                    r: cr, g: cg, b: cb,
                    intensity: proximity * (0.4 + visualEnergy * 0.6) * d * 2.5 * (0.3 + Math.random() * 0.7),
                    size: (size * 2.0 + proximity * 6) * (0.5 + Math.random() * 1.0)
                });
            }
        });

        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${C_NET[0]}, ${C_NET[1]}, ${C_NET[2]}, 0.3)`;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        edgeSparks.forEach(sp => {
            if (sp.intensity < 0.01) return;
            const sparkR = Math.max(2, sp.size);
            const sg = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, sparkR);
            sg.addColorStop(0,   `rgba(${Math.min(255, sp.r + 100)},${Math.min(255, sp.g + 80)},${Math.min(255, sp.b + 60)},${Math.min(0.9, sp.intensity).toFixed(3)})`);
            sg.addColorStop(0.3, `rgba(${sp.r},${sp.g},${sp.b},${(sp.intensity * 0.6).toFixed(3)})`);
            sg.addColorStop(0.7, `rgba(${sp.r},${sp.g},${sp.b},${(sp.intensity * 0.2).toFixed(3)})`);
            sg.addColorStop(1,   'rgba(0,0,0,0)');
            ctx.beginPath(); ctx.arc(sp.x, sp.y, sparkR, 0, Math.PI * 2);
            ctx.fillStyle = sg; ctx.fill();

            const coreR = Math.max(1, sparkR * 0.25);
            ctx.beginPath(); ctx.arc(sp.x, sp.y, coreR, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255,255,255,${Math.min(1, sp.intensity * 0.9).toFixed(3)})`;
            ctx.fill();
        });

        const outerGlow = ctx.createRadialGradient(cx, cy, R * 0.92, cx, cy, R * 1.08);
        outerGlow.addColorStop(0, `rgba(${C_NET[0]}, ${C_NET[1]}, ${C_NET[2]}, 0.12)`);
        outerGlow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.beginPath(); ctx.arc(cx, cy, R * 1.08, 0, Math.PI * 2);
        ctx.fillStyle = outerGlow; ctx.fill();

        ctx.globalCompositeOperation = 'source-over';
        frameId = requestAnimationFrame(update);
    }

    function stop(){
        if(frameId !== null) cancelAnimationFrame(frameId);
        frameId=null; motionStopped=true; ctx.clearRect(0,0,W,H);
    }
    function onMotionChange(){
        if(disposed) return;
        if(motionPreference.matches) stop();
        else if(motionStopped && frameId === null) update();
    }
    function onPageHide(event){ if(event.persisted) stop(); else dispose(); }
    function onPageShow(event){ if(event.persisted && !disposed && !motionPreference.matches && frameId === null) update(); }
    function dispose(){
        if(disposed) return;
        stop(); disposed=true;
        window.removeEventListener('mousemove',onPointerMove);
        window.removeEventListener('scroll',onScroll);
        window.removeEventListener('resize',resize);
        motionPreference.removeEventListener('change',onMotionChange);
        window.removeEventListener('pagehide',onPageHide);
        window.removeEventListener('pageshow',onPageShow);
        delete canvas[controllerKey];
    }
    canvas[controllerKey]={dispose};
    motionPreference.addEventListener('change',onMotionChange);
    window.addEventListener('resize',resize);
    window.addEventListener('pagehide',onPageHide);
    window.addEventListener('pageshow',onPageShow);
    resize();
    update();
}
initNeural(canvas);
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true}); else boot();
})();

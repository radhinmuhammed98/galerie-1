import * as THREE from 'three';

interface ParticleOptions {
  count?: number;
}

/**
 * Particules dorées 3D légères. Boucle d'animation suspendue quand hors viewport
 * pour éviter de doubler le coût GPU avec plusieurs instances simultanées.
 */
export function initParticles(container: HTMLElement, options: ParticleOptions = {}) {
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (prefersReducedMotion) return;

  const isMobile = window.innerWidth <= 768;
  // Moins de particules, plus discrètes (philosophie luxe : "l'absence est une présence")
  const particleCount = options.count ?? (isMobile ? 40 : 80);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, container.offsetWidth / container.offsetHeight, 1, 1000);
  camera.position.z = 100;

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setSize(container.offsetWidth, container.offsetHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  renderer.domElement.style.position = 'absolute';
  renderer.domElement.style.top = '0';
  renderer.domElement.style.left = '0';
  renderer.domElement.style.zIndex = '0';
  renderer.domElement.style.pointerEvents = 'none';

  container.appendChild(renderer.domElement);

  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);
  // Store base velocity and current velocity separate for decay
  const baseVelocities: { x: number; y: number }[] = [];
  const velocities: { x: number; y: number }[] = [];

  for (let i = 0; i < particleCount; i++) {
    positions[i * 3]     = (Math.random() - 0.5) * 300;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 300;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 100;
    
    const bx = (Math.random() - 0.5) * 0.05;
    const by = Math.random() * 0.1 + 0.02;
    baseVelocities.push({ x: bx, y: by });
    velocities.push({ x: bx, y: by });
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: 0xD4B886, // or-clair (plus subtil que or-fonce)
    size: 1.4,
    transparent: true,
    opacity: 0.15,   // discret, conformément à l'esthétique luxe
    blending: THREE.AdditiveBlending,
  });

  const particles = new THREE.Points(geometry, material);
  scene.add(particles);

  const handleResize = () => {
    if (!container.offsetWidth || !container.offsetHeight) return;
    camera.aspect = container.offsetWidth / container.offsetHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.offsetWidth, container.offsetHeight);
  };
  window.addEventListener('resize', handleResize);

  // Pause le rendu quand le conteneur est hors viewport (perf)
  let isVisible = true;
  const io = new IntersectionObserver(
    (entries) => entries.forEach((e) => { isVisible = e.isIntersecting; }),
    { threshold: 0 }
  );
  io.observe(container);

  let rafId = 0;
  
  // Track mouse in normalized device coordinates (-1 to +1)
  const mouse = new THREE.Vector2(999, 999);
  let isMouseMoving = false;
  let mouseTimer: number;

  const onMouseMove = (event: MouseEvent) => {
    const rect = container.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    isMouseMoving = true;
    
    clearTimeout(mouseTimer);
    mouseTimer = window.setTimeout(() => {
      isMouseMoving = false;
    }, 100);
  };
  window.addEventListener('mousemove', onMouseMove, { passive: true });

  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0); // Intersection plane at z=0

  const animate = () => {
    rafId = requestAnimationFrame(animate);
    if (!isVisible) return;

    // Calculate mouse 3D position
    let targetX = 9999;
    let targetY = 9999;
    if (isMouseMoving) {
      raycaster.setFromCamera(mouse, camera);
      const target = new THREE.Vector3();
      raycaster.ray.intersectPlane(plane, target);
      targetX = target.x;
      targetY = target.y;
    }

    const arr = geometry.attributes.position.array as Float32Array;
    
    for (let i = 0; i < particleCount; i++) {
      const px = arr[i * 3];
      const py = arr[i * 3 + 1];
      
      // Interaction physics
      if (isMouseMoving) {
        const dx = px - targetX;
        const dy = py - targetY;
        const distSq = dx * dx + dy * dy;
        const radiusSq = 2500; // ~50 units radius

        if (distSq < radiusSq && distSq > 0) {
          const dist = Math.sqrt(distSq);
          const force = (50 - dist) / 50; // 0 to 1
          
          // Exponential kick away from mouse
          velocities[i].x += (dx / dist) * force * 1.5;
          velocities[i].y += (dy / dist) * force * 1.5;
        }
      }

      // Exponential Decay: smoothly interpolate current velocity back to base velocity
      velocities[i].x += (baseVelocities[i].x - velocities[i].x) * 0.04;
      velocities[i].y += (baseVelocities[i].y - velocities[i].y) * 0.04;

      // Apply velocities
      arr[i * 3]     += velocities[i].x;
      arr[i * 3 + 1] += velocities[i].y;
      
      // Wrap around
      if (arr[i * 3 + 1] > 150) {
        arr[i * 3 + 1] = -150;
        arr[i * 3]     = (Math.random() - 0.5) * 300;
        // reset velocity on wrap
        velocities[i].x = baseVelocities[i].x;
        velocities[i].y = baseVelocities[i].y;
      }
    }
    
    geometry.attributes.position.needsUpdate = true;
    particles.rotation.y += 0.0005;
    renderer.render(scene, camera);
  };
  animate();

  // Cleanup hook (optionnel) si jamais le conteneur est retiré du DOM
  return () => {
    cancelAnimationFrame(rafId);
    io.disconnect();
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('resize', handleResize);
    renderer.dispose();
    geometry.dispose();
    material.dispose();
    if (renderer.domElement.parentNode === container) {
      container.removeChild(renderer.domElement);
    }
  };
}

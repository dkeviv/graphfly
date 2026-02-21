// Graphfly marketing website — main.js
// Lightweight vanilla JS: smooth scroll, nav active state

// Smooth scroll for anchor links already handled by CSS scroll-behavior: smooth
// Add active nav link based on scroll position

const navLinks = [...document.querySelectorAll('.nav__link[href^="#"]')];
const sections = navLinks
  .map((a) => {
    const id = a.getAttribute('href').slice(1);
    return { a, el: document.getElementById(id) };
  })
  .filter((s) => s.el);

function updateActiveLink() {
  const scrollY = window.scrollY + 80;
  let active = null;
  for (const { a, el } of sections) {
    if (el.offsetTop <= scrollY) active = a;
  }
  for (const { a } of sections) {
    a.classList.toggle('nav__link--active', a === active);
  }
}

window.addEventListener('scroll', updateActiveLink, { passive: true });
updateActiveLink();

// Animate elements into view
const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('in-view');
        observer.unobserve(entry.target);
      }
    }
  },
  { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
);

for (const el of document.querySelectorAll('.step, .feature-card, .pricing-card, .quote')) {
  observer.observe(el);
}

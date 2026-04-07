/* ============================================================
   SIGNAL LOGIC SYSTEMS — main.js
   Shared JavaScript for all pages
   ============================================================ */

document.addEventListener('DOMContentLoaded', function () {

  // ─── Init Lucide Icons ──────────────────────────────────
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }

  // ─── Sticky Nav ─────────────────────────────────────────
  const nav = document.querySelector('.site-nav');
  if (nav) {
    const onScroll = () => {
      nav.classList.toggle('scrolled', window.scrollY > 20);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // ─── Active Nav Link ────────────────────────────────────
  const currentFile = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-links a, .mobile-menu a').forEach(link => {
    const href = link.getAttribute('href');
    if (
      href === currentFile ||
      (currentFile === '' && href === 'index.html') ||
      (currentFile === '/' && href === 'index.html')
    ) {
      link.classList.add('active');
    }
  });

  // ─── Mobile Menu ────────────────────────────────────────
  const hamburger  = document.querySelector('.hamburger');
  const mobileMenu = document.querySelector('.mobile-menu');

  if (hamburger && mobileMenu) {
    hamburger.addEventListener('click', () => {
      const isOpen = mobileMenu.classList.contains('open');
      hamburger.classList.toggle('open', !isOpen);
      mobileMenu.classList.toggle('open', !isOpen);
      document.body.style.overflow = isOpen ? '' : 'hidden';
    });

    // Close on any link click in the mobile menu
    mobileMenu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        hamburger.classList.remove('open');
        mobileMenu.classList.remove('open');
        document.body.style.overflow = '';
      });
    });
  }

  // ─── FAQ Accordion ──────────────────────────────────────
  document.querySelectorAll('.faq-question').forEach(btn => {
    btn.addEventListener('click', function () {
      const expanded = this.getAttribute('aria-expanded') === 'true';
      const answer   = this.nextElementSibling;

      // Collapse all
      document.querySelectorAll('.faq-question').forEach(b => {
        b.setAttribute('aria-expanded', 'false');
        const a = b.nextElementSibling;
        if (a) a.style.maxHeight = null;
      });

      // Open this one if it was collapsed
      if (!expanded) {
        this.setAttribute('aria-expanded', 'true');
        answer.style.maxHeight = answer.scrollHeight + 'px';
      }
    });
  });

  // ─── Snapshot Form Success State ────────────────────────
  const snapshotForm = document.getElementById('snapshotForm');
  const formSuccess  = document.getElementById('formSuccess');

  if (snapshotForm && formSuccess) {
    snapshotForm.addEventListener('submit', function (e) {
      e.preventDefault();
      snapshotForm.style.display = 'none';
      formSuccess.style.display = 'block';
      if (typeof lucide !== 'undefined') lucide.createIcons();
      formSuccess.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  // ─── Smooth scroll for anchor links ─────────────────────
  document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', function (e) {
      const target = document.querySelector(this.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

});

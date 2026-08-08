/*
	Site chrome: preload flag, mobile menu, active nav link, smooth scrolling.

	Originally the Solid State theme's main.js (html5up.net, CCA 3.0). Every
	template feature the site actually uses is reimplemented here without
	jQuery, so the page no longer ships jQuery, scrollex, browser.js,
	breakpoints.js or util.js just to run ~100 lines of DOM work.
*/
(function () {
	'use strict';

	var body = document.body;
	var header = document.getElementById('header');

	// main.css suppresses all animation/transition while .is-preload is set,
	// so nothing animates mid-layout on first paint.
	window.addEventListener('load', function () {
		window.setTimeout(function () {
			body.classList.remove('is-preload');
		}, 100);
	});

	/* ---------- Mobile menu ---------- */

	/*
		The slide-out menu is injected rather than repeated in all three
		pages' markup, so the links only need updating in one place. The
		desktop <nav> is hand-authored per page (it carries the page's
		active link and CTA), so nothing is injected for it.
	*/
	function buildMobileMenu() {
		var nav = document.createElement('nav');
		nav.id = 'mobile-menu';
		nav.innerHTML =
			'<div class="inner">' +
				'<a href="#" class="close" aria-label="Close menu">&times;</a>' +
				'<ul class="links">' +
					'<li><a href="index.html">Home</a></li>' +
					'<li><a href="aboutus.html">About Us</a></li>' +
					'<li><a href="opportunities.html">Opportunities</a></li>' +
				'</ul>' +
				'<a href="opportunities.html" class="mobile-nav-cta">Get Involved</a>' +
			'</div>';
		body.appendChild(nav);
		return nav;
	}

	var mobileMenu = document.getElementById('mobile-menu') || buildMobileMenu();
	var mobileToggle = document.getElementById('mobile-menu-toggle');

	function setMenuOpen(open) {
		mobileMenu.classList.toggle('is-visible', open);
		body.classList.toggle('nav-open', open);
		if (mobileToggle) {
			mobileToggle.classList.toggle('is-active', open);
			mobileToggle.setAttribute('aria-expanded', String(open));
		}
	}

	function closeMobileMenu() {
		if (mobileMenu.classList.contains('is-visible')) setMenuOpen(false);
	}

	if (mobileToggle) {
		mobileToggle.addEventListener('click', function (event) {
			event.preventDefault();
			// Without this the document-level handler below sees the same
			// click and closes the menu again immediately.
			event.stopPropagation();
			setMenuOpen(!mobileMenu.classList.contains('is-visible'));
		});
	}

	mobileMenu.addEventListener('click', function (event) {
		if (!event.target.closest('a')) return;
		if (event.target.closest('.close')) event.preventDefault();
		closeMobileMenu();
	});

	document.addEventListener('click', function (event) {
		if (!mobileMenu.contains(event.target)) closeMobileMenu();
	});

	document.addEventListener('keydown', function (event) {
		if (event.key === 'Escape') closeMobileMenu();
	});

	/* ---------- Active nav link ---------- */

	/*
		Each page hand-marks its own active link; this only fills in the
		mobile menu, which is injected and so cannot. The "Get Involved"
		CTAs point at opportunities.html too, and are deliberately excluded -
		they are buttons, not nav state.
	*/
	(function highlightActivePage() {
		var currentPage = window.location.pathname.split('/').pop() || 'index.html';
		var links = mobileMenu.querySelectorAll('ul.links a[href="' + currentPage + '"]');
		Array.prototype.forEach.call(links, function (link) {
			link.classList.add('active');
		});
	})();

	/* ---------- Smooth scrolling for in-page anchors ---------- */

	document.addEventListener('click', function (event) {
		var link = event.target.closest('a[href^="#"]');
		if (!link) return;

		var hash = link.getAttribute('href');
		if (hash === '#' || link.id === 'mobile-menu-toggle') return;

		var target = document.querySelector(hash);
		if (!target) return;

		event.preventDefault();
		// Offset by the sticky header so the target isn't hidden underneath it.
		var top = target.getBoundingClientRect().top + window.pageYOffset -
			(header ? header.offsetHeight : 0);
		window.scrollTo({ top: top, behavior: 'smooth' });
	});
})();

/*
	Shared volunteer-opportunity feed.

	index.html (6 shuffled cards) and opportunities.html (full filterable
	list) both read the same published Google Sheet CSV. They used to carry
	their own near-identical copy of the fetch/parse/render/popup code, which
	is how the two drifted apart - the homepage copy never parsed the hours
	column, so its popup rendered "Time Commitment: undefined". Everything
	shared now lives here and both pages call into it.

	Requires Papa Parse (loaded from CDN by the pages that use this file).
*/
(function (window, document) {
	'use strict';

	var SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRINdpIfqYzmz7lNtKIkIuz75kA3wAOtAyE2lThkMty1Gpn7X9p3xIFLXV-hyX28PC-0LyFreFc1JXU/pub?gid=351680604&single=true&output=csv';
	var FALLBACK_IMAGE = 'images/causecircuit-logo.png';

	// Bucket -> the label shown on a card's commitment pill. Mirrors the
	// wording of the Commitment dropdown on opportunities.html.
	var COMMITMENT_LABELS = {
		short: '1-3 hrs/week',
		medium: '4-10 hrs/week',
		long: '10+ hrs/week',
		flexible: 'Flexible hours'
	};

	/*
		Every field below comes from a public Google Form that any
		organization can submit to, so it is untrusted input. It all ends up
		inside innerHTML, so escape it rather than letting a stray quote or
		angle bracket break the card markup (or inject into the page).
	*/
	function escapeHtml(value) {
		return String(value == null ? '' : value)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	// Case- and whitespace-insensitive, since these are free-text form answers.
	function isSameText(a, b) {
		return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
	}

	/*
		The form's contact question asks for "Name: Email" as one free-text
		answer, but only the email is worth showing in the popup - pull just
		that out and drop the name.
	*/
	function extractEmail(raw) {
		var match = String(raw || '').match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
		return match ? match[0] : '';
	}

	function resolveImage(rawImagePath) {
		if (!rawImagePath) return FALLBACK_IMAGE;

		if (rawImagePath.indexOf('drive.google.com') !== -1) {
			var matches = rawImagePath.match(/(?:id=|\/d\/)([a-zA-Z0-9-_]+)/);
			// lh3.googleusercontent.com is Google's stable public image CDN.
			// drive.google.com/thumbnail and uc?export=view both intermittently
			// 403/block on mobile browsers due to referrer/UA checks; this
			// endpoint hotlinks reliably across devices and supports a size hint.
			return (matches && matches[1])
				? 'https://lh3.googleusercontent.com/d/' + matches[1] + '=w1000'
				: FALLBACK_IMAGE;
		}

		return rawImagePath;
	}

	// Returns a safe absolute http(s) URL, or '' when there isn't a usable one.
	function resolveUrl(opportunity) {
		var raw = (opportunity && opportunity.website) ? String(opportunity.website).trim() : '';
		if (!raw || raw === '#') return '';

		if (!/^https?:\/\//i.test(raw)) {
			// A value carrying any other scheme (javascript:, data:, ...) is
			// not a website - drop it instead of prefixing https:// onto it.
			if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return '';

			/*
				The form asks submitters to "Write N/A if none", and they also
				type free text like "none" or a bare handle. Prefixing https://
				onto those produced links to hosts that cannot resolve, so
				require something that at least looks like a hostname: a dot
				with label characters on both sides.
			*/
			if (!/^[^\s\/]+\.[a-z]{2,}/i.test(raw)) return '';

			raw = 'https://' + raw.replace(/^\/+/, '');
		}

		return raw;
	}

	/*
		Free-text hours cell -> filter bucket. Handles plain numbers ("5"),
		ranges ("4-10"), open-ended values ("10+") and written-out answers
		("short term"). Note the "+" check: parseInt("10+") is 10, which would
		otherwise classify an open-ended 10+ commitment as medium.
	*/
	function classifyCommitment(rawHours) {
		var text = String(rawHours || '').toLowerCase();
		if (!text) return 'flexible';

		var numberMatch = text.match(/\d+(?:\.\d+)?/);
		if (numberMatch) {
			var hours = parseFloat(numberMatch[0]);
			if (text.indexOf('+') !== -1 && hours >= 10) return 'long';
			if (hours <= 3) return 'short';
			if (hours <= 10) return 'medium';
			return 'long';
		}

		if (text.indexOf('short') !== -1) return 'short';
		if (text.indexOf('med') !== -1) return 'medium';
		if (text.indexOf('long') !== -1) return 'long';
		return 'flexible';
	}

	function formatHours(rawHours) {
		if (!rawHours) return 'Flexible';
		// Only a bare number needs the unit appended; "5 hrs/week" already
		// reads fine and would otherwise become "5 hrs/week hours".
		return /^\d+(\.\d+)?$/.test(rawHours) ? rawHours + ' hours' : rawHours;
	}

	/*
		Response-metadata columns that never hold opportunity content. They are
		excluded from matching entirely because they collide with real
		matchers: Google Forms prepends a "Timestamp" column to every response
		sheet, and "timestamp" contains "time", so the hours lookup below used
		to resolve to the submission time - every opportunity was bucketed
		4-10 hrs/week and its popup read "Time Commitment: 8/6/2026 11:20:11".
	*/
	var IGNORED_COLUMNS = ['timestamp', 'date of submission', 'status'];

	/*
		The sheet's headers are whatever the form asks, so columns are matched
		by keyword with a positional fallback. Keep the two in sync with the
		form: the positional fallbacks are a last resort and will pick the
		wrong column if the form's question order changes.
	*/
	function mapRow(row) {
		var keys = Object.keys(row);

		var eligible = keys.filter(function (key) {
			var lower = key.toLowerCase();
			return !IGNORED_COLUMNS.some(function (ignored) {
				return lower.indexOf(ignored) !== -1;
			});
		});

		/*
			Once a column has won a field by keyword, it's off the table for
			every keyword search after it. Free-text question wording can
			accidentally contain another field's keyword - the description
			question asks submitters to write something "to use on our
			website for your opportunity", so its own column contains the
			word "website" and, sitting earlier in the sheet than the real
			website-link column, used to win the website field's match
			outright. Fields are picked in a fixed order below (description
			before website), so claiming a column the moment a keyword wins
			it lets the later, real match win instead of the earlier
			coincidental one.

			Only keyword wins claim a column - a positional fallback does
			not. Several fields fall back to the same column on purpose (this
			form has no dedicated title question, so title's fallback reuses
			company's own name column - see the isSameText check on the
			card/popup subtitle); claiming on fallback would make the first
			of those to run lock the column out for the rest.
		*/
		var claimed = {};

		function pick(matchers, fallbackIndex) {
			/*
				Matchers are tried in their own order rather than the sheet's,
				so a precise term ("hour") wins over a loose one ("time") no
				matter which column happens to come first.
			*/
			for (var i = 0; i < matchers.length; i++) {
				var matcher = matchers[i];
				var found = eligible.find(function (key) {
					return !claimed[key] && key.toLowerCase().indexOf(matcher) !== -1;
				});
				if (found) {
					claimed[found] = true;
					return found;
				}
			}
			return typeof fallbackIndex === 'number' ? keys[fallbackIndex] : '';
		}

		function read(key, fallback) {
			var value = key && row[key] ? String(row[key]).trim() : '';
			return value || (fallback || '');
		}

		var title = read(pick(['title', 'name of opportunity', 'position'], 1));
		var org = read(pick(['organization', 'company', 'host'], 2));

		// A row without both of these isn't a renderable opportunity.
		if (!title || !org) return null;

		/*
			No positional fallback here on purpose. The form has no hours
			question at all, and column 6 is "Primary Phone Number:" - falling
			back to it would parse a phone number into an hours bucket. With no
			match the row is simply "Flexible", which is at least true.
		*/
		var rawHours = read(pick(['hour', 'commitment', 'time']));
		var commitment = classifyCommitment(rawHours);

		return {
			name: title,
			company: org,
			description: read(pick(['description', 'detail', 'about'], 3), 'No description provided.'),
			website: read(pick(['link', 'website', 'url', 'form'], 4)),
			/*
				No positional fallback, unlike the fields above. Column 5 is
				"Primary Contact Name & Email", so a form edit that dropped the
				words city/town/location from the question - "What *area* in
				Durham are you located in?" being the obvious rewording -
				resolved every listing's city to a contact email, which then
				showed in the card's location pill and became an option in the
				location filter. Silently: nothing errored, the towns just
				turned into email addresses.

				The extra matchers cover the likely rewordings - no other
				current header contains "durham", "area" or "municipal", so
				none of them can capture the wrong column - and with the
				fallback gone an unmatched column leaves the city empty rather
				than confidently wrong. "location" stays last because it is the
				loosest: it would also match an "Address/Meeting site" question
				reworded to "Location of the opportunity". "city"/"town" are
				tried first, so the real column still wins whenever it is there.

				There is no 'Oshawa' default any more either - a blank cell used
				to put the listing in a town it had never claimed. Callers omit
				the pill and the popup row when this is empty.
			*/
			city: read(pick(['city', 'town', 'durham', 'area', 'municipal', 'location'])),
			imagePath: resolveImage(read(pick(['image', 'logo', 'pic']))),
			timeCommitment: commitment,
			commitmentLabel: COMMITMENT_LABELS[commitment],
			hoursPerWeek: formatHours(rawHours),
			/*
				Kept separate from the hours bucket above rather than folded
				into it: "Weekdays" answers when you would volunteer, not how
				much of your week it costs, and the commitment filter needs the
				latter. Shown as its own popup row, and only when the form
				actually collected one.
			*/
			schedule: read(pick(['schedule'])),
			orgType: read(pick(['type of organization'])),
			category: read(pick(['category'])),
			format: read(pick(['format'])),
			address: read(pick(['address'])),
			// Form asks for "Minimum age", not a grade - closest thing it collects.
			minAge: read(pick(['grade', 'minimum age', 'age'])),
			deadline: read(pick(['deadline'])),
			contactEmail: extractEmail(read(pick(['contact']))),
			phone: read(pick(['phone']))
		};
	}

	function fetchOpportunities() {
		var cacheBuster = '&t=' + Date.now();

		return window.fetch(SHEET_CSV_URL + cacheBuster)
			.then(function (response) {
				if (!response.ok) {
					throw new Error('Sheet request failed with status ' + response.status);
				}
				return response.text();
			})
			.then(function (csvText) {
				return new Promise(function (resolve, reject) {
					window.Papa.parse(csvText, {
						header: true,
						skipEmptyLines: true,
						complete: function (results) {
							resolve(results.data.map(mapRow).filter(Boolean));
						},
						error: reject
					});
				});
			});
	}

	/*
		One observer per page, reused across renders. The previous code built a
		fresh IntersectionObserver on every render of the opportunities list -
		and the search box re-renders on each keystroke - so observers piled up,
		each still holding references to cards that had been removed from the DOM.
	*/
	var revealObserver = null;

	/*
		Cards enter with a short cascade rather than all at once. That delay
		used to be baked into each card at build time as index * 0.1s, which
		suited the homepage's six and broke down on the full list: the 40th
		card carried a four-second delay, so once the feed grew, scrolling
		reached cards that sat invisible for seconds after they were already
		on screen. Staggering the batch that crosses the threshold together
		keeps the cascade and bounds the wait - a batch is only ever as large
		as what fits on one screen, however long the list gets.
	*/
	var REVEAL_STAGGER_MS = 60;
	var REVEAL_STAGGER_CAP = 6;

	// Adds .animate to an element once it scrolls into view.
	function reveal(element) {
		if (!element) return;

		if (!('IntersectionObserver' in window)) {
			element.classList.add('animate');
			return;
		}

		if (!revealObserver) {
			revealObserver = new IntersectionObserver(function (entries, observer) {
				var shown = 0;

				entries.forEach(function (entry) {
					if (!entry.isIntersecting) return;

					// Position within this batch, not within the whole list.
					entry.target.style.transitionDelay =
						(Math.min(shown, REVEAL_STAGGER_CAP) * REVEAL_STAGGER_MS) + 'ms';
					shown++;

					entry.target.classList.add('animate');
					// Fire-once: stop tracking the element after it animates in.
					observer.unobserve(entry.target);
				});
			}, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });
		}

		revealObserver.observe(element);
	}

	function buildCard(opportunity, index, options) {
		var card = document.createElement('div');
		card.className = 'opportunity-card';
		// Index into the currently rendered list. Looked up on click instead of
		// matching the card's title text, which silently opened the wrong popup
		// whenever two opportunities shared a name.
		card.dataset.index = String(index);

		// Always a plain button, never a direct link - clicking anywhere on
		// the card (including this button) opens the popup, where the
		// site's actual link lives. See resolveUrl()/popupMarkup().
		var buttonHTML = '<button type="button" class="card-btn">Learn more</button>';

		/*
			The form has no separate opportunity-title question, so the title
			falls back to the organization name and the subtitle would repeat
			the heading verbatim. Drop it in that case; it returns on its own
			once the form collects a real title.
		*/
		var orgHTML = isSameText(opportunity.company, opportunity.name)
			? ''
			: '<p class="card-org">' + escapeHtml(opportunity.company) + '</p>';

		/*
			Shown on the tile itself rather than only inside the popup, so a
			reader can reach the organization's site without opening "Learn
			more" first. Sits next to that button rather than under the org
			name so the tile keeps a single row of actions. stopPropagation
			keeps the click on the button instead of also triggering the
			card's own click handler, which would pop the details modal open
			behind the new tab.
		*/
		var websiteUrl = resolveUrl(opportunity);
		var websiteButtonHTML = websiteUrl
			? '<a class="card-website-btn" href="' + escapeHtml(websiteUrl) + '" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">' +
				'Visit Website <span aria-hidden="true">&#8599;</span></a>'
			: '';

		// An unresolved or unanswered city leaves no pill, rather than an
		// empty one floating over the image. See mapRow's city matcher.
		var locationTagHTML = opportunity.city
			? '<div class="location-tag">' + escapeHtml(opportunity.city) + '</div>'
			: '';

		var commitmentHTML = '';
		var hoursHTML = '';
		if (options.showCommitment) {
			commitmentHTML =
				'<div class="commitment-tags"><span class="commitment-tag">' +
				escapeHtml(opportunity.commitmentLabel) + '</span></div>';
			hoursHTML =
				'<div class="hours-per-week">Hours required: ' +
				escapeHtml(opportunity.hoursPerWeek) + '</div>';
		}

		card.innerHTML =
			'<div class="card-image-container">' +
				'<img src="' + escapeHtml(opportunity.imagePath) + '" alt="' + escapeHtml(opportunity.name) + '"' +
					' loading="lazy" decoding="async"' +
					// onerror is cleared first so a failing fallback can't loop.
					' onerror="this.onerror=null;this.src=\'' + FALLBACK_IMAGE + '\'" />' +
				locationTagHTML +
			'</div>' +
			'<div class="card-content">' +
				'<h3>' + escapeHtml(opportunity.name) + '</h3>' +
				orgHTML +
				'<p class="card-desc-clamp">' + escapeHtml(opportunity.description) + '</p>' +
				commitmentHTML +
				hoursHTML +
				'<div class="card-actions">' + websiteButtonHTML + buttonHTML + '</div>' +
			'</div>';

		return card;
	}

	/*
		Renders `list` into `container` and remembers it there, so the click
		handler can resolve a card back to its opportunity.
		options: { showCommitment, emptyMessage }
	*/
	function renderCards(container, list, options) {
		if (!container) return;

		options = options || {};
		container.renderedOpportunities = list;
		container.innerHTML = '';

		if (!list.length) {
			container.innerHTML = '<div class="empty-state">' +
				escapeHtml(options.emptyMessage || 'No opportunities available right now.') +
				'</div>';
			return;
		}

		list.forEach(function (opportunity, index) {
			var card = buildCard(opportunity, index, options);
			container.appendChild(card);
			reveal(card);
		});
	}

	function showMessage(container, message) {
		if (!container) return;
		container.renderedOpportunities = [];
		container.innerHTML = '<div class="empty-state">' + escapeHtml(message) + '</div>';
	}

	/* ---------- Popup ---------- */

	/*
		A labelled fact, rendered as its own small card inside a section's
		grid. `wide` makes a value that needs the whole width (a street
		address) span every column instead of being squeezed into one.
	*/
	function infoRow(label, value, opts) {
		opts = opts || {};
		return '<div class="popup-info-row' + (opts.wide ? ' popup-info-row--wide' : '') + '">' +
			'<span class="popup-info-label">' + label + '</span>' +
			'<span class="popup-info-value">' + value + '</span>' +
			'</div>';
	}

	/*
		Contact entries make the entire row the link rather than just the
		value text. A phone number or address is something you act on, and a
		full-row target is far easier to hit on a phone than one short line
		of link text.
	*/
	function infoLinkRow(label, href, text, attrs) {
		return '<a class="popup-info-row popup-info-row--wide popup-contact-row" href="' + escapeHtml(href) + '"' +
			(attrs || '') + '>' +
			'<span class="popup-info-label">' + label + '</span>' +
			'<span class="popup-info-value">' + escapeHtml(text) + '</span>' +
			'</a>';
	}

	/*
		Groups related facts into their own bordered card. Returns '' when
		every row in the group is missing, so an organization that skipped a
		whole category of questions leaves no empty section behind.
	*/
	function infoSection(title, rows, extraClass) {
		var body = rows.filter(Boolean).join('');
		if (!body) return '';

		return '<section class="popup-section' + (extraClass ? ' ' + extraClass : '') + '">' +
			'<h3 class="popup-section-title">' + title + '</h3>' +
			'<div class="popup-info-grid">' + body + '</div>' +
			'</section>';
	}

	/*
		Short categorical answers (category, format, organization type) read
		better as pills under the title than as three more label/value rows -
		they are the at-a-glance framing for everything below. The label is
		kept for screen readers, which would otherwise get a bare word with
		no indication of what it describes.
	*/
	function metaTag(label, value) {
		if (!value) return '';
		return '<span class="popup-meta-tag" aria-label="' + label + ': ' + escapeHtml(value) + '">' +
			escapeHtml(value) + '</span>';
	}

	function popupMarkup(opportunity) {
		// Same reasoning as the card subtitle: with no title question on the
		// form, the host name repeats the popup heading word for word.
		var hostHTML = isSameText(opportunity.company, opportunity.name)
			? ''
			: '<p class="popup-host">' + escapeHtml(opportunity.company) + '</p>';

		var metaTags =
			metaTag('Category', opportunity.category) +
			metaTag('Format', opportunity.format) +
			metaTag('Organization type', opportunity.orgType);
		var metaHTML = metaTags ? '<div class="popup-meta">' + metaTags + '</div>' : '';

		// Leads the popup: what the opportunity actually is matters more than
		// any single logistical detail below it.
		var aboutHTML =
			'<section class="popup-section">' +
				'<h3 class="popup-section-title">About</h3>' +
				'<p class="popup-about">' + escapeHtml(opportunity.description) + '</p>' +
			'</section>';

		var scheduleHTML = infoSection('Schedule &amp; Commitment', [
			opportunity.schedule ? infoRow('Schedule', escapeHtml(opportunity.schedule)) : '',
			infoRow('Time Commitment', escapeHtml(opportunity.hoursPerWeek)),
			opportunity.deadline ? infoRow('Application Deadline', escapeHtml(opportunity.deadline)) : ''
		]);

		var locationHTML = infoSection('Location', [
			opportunity.city ? infoRow('City', escapeHtml(opportunity.city)) : '',
			opportunity.address ? infoRow('Address', escapeHtml(opportunity.address), { wide: true }) : ''
		]);

		var eligibilityHTML = infoSection('Eligibility', [
			opportunity.minAge ? infoRow('Minimum Age', escapeHtml(opportunity.minAge)) : ''
		]);

		/*
			Contact closes the popup rather than opening it: you read what the
			opportunity is and whether it fits before you reach for how to get
			in touch about it.
		*/
		var websiteUrl = resolveUrl(opportunity);
		// A tel: link only works once the free-text answer is reduced to digits
		// (plus a leading +); the visible label keeps the original formatting.
		var phoneDigits = String(opportunity.phone || '').replace(/[^\d+]/g, '');

		var contactRows = [
			websiteUrl
				? infoLinkRow('Website', websiteUrl, websiteUrl.replace(/^https?:\/\//i, ''),
					' target="_blank" rel="noopener noreferrer"')
				: '',
			opportunity.contactEmail
				? infoLinkRow('Email', 'mailto:' + opportunity.contactEmail, opportunity.contactEmail)
				: '',
			phoneDigits
				? infoLinkRow('Phone', 'tel:' + phoneDigits, opportunity.phone)
				: (opportunity.phone ? infoRow('Phone', escapeHtml(opportunity.phone), { wide: true }) : '')
		].filter(Boolean);

		/*
			The one section that says something by being empty. Every other
			group can simply disappear, but a reader who has decided they want
			this opportunity needs to know the organization left no way to
			reach it - silently dropping the section reads as a page bug.
		*/
		var contactHTML = contactRows.length
			? infoSection('Contact', contactRows, 'popup-section--contact')
			: '<section class="popup-section popup-section--contact">' +
					'<h3 class="popup-section-title">Contact</h3>' +
					'<p class="popup-empty-note">This organization did not provide contact details.</p>' +
				'</section>';

		return '' +
			'<div class="popup-header">' +
				'<img src="' + escapeHtml(opportunity.imagePath) + '" alt="' + escapeHtml(opportunity.name) + '"' +
					' decoding="async" onerror="this.onerror=null;this.src=\'' + FALLBACK_IMAGE + '\'" />' +
				(opportunity.city
					? '<div class="popup-location-tag">' + escapeHtml(opportunity.city) + '</div>'
					: '') +
			'</div>' +
			'<h2 class="popup-title" id="popup-title">' + escapeHtml(opportunity.name) + '</h2>' +
			'<div class="popup-scroll-content">' +
				hostHTML +
				metaHTML +
				aboutHTML +
				scheduleHTML +
				locationHTML +
				eligibilityHTML +
				contactHTML +
			'</div>' +
			'<div class="popup-actions">' +
				'<button type="button" class="btn btn-ghost popup-close">Close</button>' +
			'</div>';
	}

	/*
		Wires the shared popup plus the card-click delegation for every
		container on the page. Returns nothing; call once on DOM ready.
	*/
	function initPopup() {
		var popup = document.getElementById('popup');
		var popupContent = document.getElementById('popup-content');
		if (!popup || !popupContent) return;

		// Element focused before the popup opened, so focus can be restored.
		var lastFocused = null;

		function close() {
			if (!popup.classList.contains('active')) return;
			popup.classList.remove('active');
			document.body.classList.remove('modal-open');
			popupContent.innerHTML = '';
			if (lastFocused && lastFocused.focus) lastFocused.focus();
			lastFocused = null;
		}

		function open(opportunity) {
			lastFocused = document.activeElement;
			popupContent.innerHTML = popupMarkup(opportunity);
			popup.classList.add('active');
			document.body.classList.add('modal-open');

			var closeBtn = popupContent.querySelector('.popup-close');
			closeBtn.addEventListener('click', close);
			closeBtn.focus();
		}

		document.addEventListener('click', function (event) {
			var card = event.target.closest('.opportunity-card');
			if (!card) return;

			var container = card.parentElement;
			var list = container && container.renderedOpportunities;
			var opportunity = list && list[Number(card.dataset.index)];
			if (opportunity) open(opportunity);
		});

		popup.addEventListener('click', function (event) {
			if (event.target === popup) close();
		});

		document.addEventListener('keydown', function (event) {
			if (event.key === 'Escape') close();
		});
	}

	window.CauseCircuit = {
		fetchOpportunities: fetchOpportunities,
		renderCards: renderCards,
		showMessage: showMessage,
		initPopup: initPopup,
		reveal: reveal
	};
})(window, document);
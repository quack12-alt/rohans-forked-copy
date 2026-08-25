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

		function pick(matchers, fallbackIndex) {
			/*
				Matchers are tried in their own order rather than the sheet's,
				so a precise term ("hour") wins over a loose one ("time") no
				matter which column happens to come first.
			*/
			for (var i = 0; i < matchers.length; i++) {
				var matcher = matchers[i];
				var found = eligible.find(function (key) {
					return key.toLowerCase().indexOf(matcher) !== -1;
				});
				if (found) return found;
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
			city: read(pick(['city', 'town', 'location'], 5), 'Oshawa'),
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
			schedule: read(pick(['schedule']))
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

	// Adds .animate to an element once it scrolls into view.
	function reveal(element) {
		if (!element) return;

		if (!('IntersectionObserver' in window)) {
			element.classList.add('animate');
			return;
		}

		if (!revealObserver) {
			revealObserver = new IntersectionObserver(function (entries, observer) {
				entries.forEach(function (entry) {
					if (entry.isIntersecting) {
						entry.target.classList.add('animate');
						// Fire-once: stop tracking the element after it animates in.
						observer.unobserve(entry.target);
					}
				});
			}, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });
		}

		revealObserver.observe(element);
	}

	function buildCard(opportunity, index, options) {
		var card = document.createElement('div');
		card.className = 'opportunity-card';
		card.style.transitionDelay = (index * 0.1) + 's';
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
				'<div class="location-tag">' + escapeHtml(opportunity.city) + '</div>' +
			'</div>' +
			'<div class="card-content">' +
				'<h3>' + escapeHtml(opportunity.name) + '</h3>' +
				orgHTML +
				'<p class="card-desc-clamp">' + escapeHtml(opportunity.description) + '</p>' +
				commitmentHTML +
				hoursHTML +
				buttonHTML +
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

	function popupMarkup(opportunity) {
		var websiteUrl = resolveUrl(opportunity);
		var websiteValue = websiteUrl
			? '<a href="' + escapeHtml(websiteUrl) + '" target="_blank" rel="noopener noreferrer">' +
				escapeHtml(websiteUrl.replace(/^https?:\/\//i, '')) + '</a>'
			: 'Not provided';

		function row(label, value, extraClass) {
			return '<div class="popup-info-row">' +
				'<span class="popup-info-label">' + label + '</span>' +
				'<span class="popup-info-value' + (extraClass || '') + '">' + value + '</span>' +
				'</div>';
		}

		// Same reasoning as the card subtitle: with no title question on the
		// form, Host repeats the popup heading word for word.
		var hostRow = isSameText(opportunity.company, opportunity.name)
			? ''
			: row('Host', escapeHtml(opportunity.company));

		// Only present once the form asks for a schedule.
		var scheduleRow = opportunity.schedule
			? row('Schedule', escapeHtml(opportunity.schedule))
			: '';

		return '' +
			'<div class="popup-header">' +
				'<img src="' + escapeHtml(opportunity.imagePath) + '" alt="' + escapeHtml(opportunity.name) + '"' +
					' decoding="async" onerror="this.onerror=null;this.src=\'' + FALLBACK_IMAGE + '\'" />' +
				'<div class="popup-location-tag">' + escapeHtml(opportunity.city) + '</div>' +
			'</div>' +
			'<h2 class="popup-title" id="popup-title">' + escapeHtml(opportunity.name) + '</h2>' +
			'<div class="popup-scroll-content">' +
				'<div class="popup-info-panel">' +
					hostRow +
					row('Website', websiteValue, websiteUrl ? '' : ' muted') +
					row('Location', escapeHtml(opportunity.city)) +
					row('Time Commitment', escapeHtml(opportunity.hoursPerWeek)) +
					scheduleRow +
				'</div>' +
				'<div class="popup-body"><p>' + escapeHtml(opportunity.description) + '</p></div>' +
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
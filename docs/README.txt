Cause Circuit is a youth-led initiative that empowers high school students across the Durham Region to take meaningful action through volunteering. We strive to cultivate a culture of compassion, leadership, and civic responsibility by connecting students with opportunities that make a real difference in their communities.

This folder is the published site (GitHub Pages serves from docs/).

3 HTML Pages:
  index.html - Landing page: hero, about, social media, and a shuffled
               six-card preview of live opportunities
  aboutus.html - About the organization
  opportunities.html - Full volunteer opportunities listing, with location,
                       commitment and organization-search filters

CSS Files:
  main.css - Base template styles (Solid State by HTML5 UP)
  site-theme.css - The site's own look, layered over the template. Almost
                   everything you would want to restyle lives here.

JavaScript Files:
  main.js - Site chrome: preload flag, mobile menu, active nav link,
            smooth scrolling. No jQuery.
  opportunities.js - The opportunity feed, shared by index.html and
                     opportunities.html so a tile is identical on both.
                     Fetches the published Google Sheet CSV, maps the form's
                     columns, renders the cards and drives the popup.

  Papa Parse is loaded from a CDN by the two pages that read the sheet.

Where the opportunity data comes from:
  Organizations submit a public Google Form. Its responses sheet is published
  as CSV and fetched at page load - there is no build step and no server.
  opportunities.js matches the sheet's columns by keyword, so renaming a form
  question is usually safe but reordering or removing one is not. If a field
  stops appearing on the cards, check the matchers in mapRow() first.

  ../apps-script/imageSync.gs is a companion Apps Script that copies photos
  submitted through the form into images/.

Images:
  causecircuit-logo.png - Logo, and the fallback for any opportunity whose
                          image is missing or fails to load
  bg.jpg - Referenced by main.css
  pic01.jpg, pic02.jpg - Used on the pages
  pic03.jpg - pic08.jpg - Template leftovers, not currently referenced
  Remaining .png files - Organization logos synced from form submissions

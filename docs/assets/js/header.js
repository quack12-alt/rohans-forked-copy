// Create a file called header.js and include this code
document.addEventListener('DOMContentLoaded', function() {
    // Header HTML content
    const headerHTML = `
        <header id="header">
            <h1><a href="index.html">CauseCircuit</a></h1>
            
            <!-- Desktop Navigation -->
            <nav id="nav">
                <ul class="links">
                    <li><a href="index.html">Home</a></li>
                    <li><a href="aboutus.html">About Us</a></li>
                    <li><a href="opportunities.html">Opportunities</a></li>
                    
                </ul>
            </nav>
            
            <!-- Mobile Menu Toggle -->
            <a href="#mobile-menu" id="mobile-menu-toggle">
                <span class="icon solid fa-bars"></span>
            </a>
        </header>

        <!-- Mobile Menu -->
        <nav id="mobile-menu">
            <div class="inner">
                <h2>Menu</h2>
                <ul class="links">
                    <li><a href="index.html">Home</a></li>
                    <li><a href="aboutus.html">About Us</a></li>
                    <li><a href="opportunities.html">Opportunities</a></li>
                    
                </ul>
                <a href="#" class="close">Close</a>
            </div>
        </nav>
    `;
    
    // Find the page wrapper and insert header at the beginning
    const pageWrapper = document.getElementById('page-wrapper');
    if (pageWrapper) {
        pageWrapper.insertAdjacentHTML('afterbegin', headerHTML);
    }
    
    // Initialize the mobile menu functionality after header is loaded
    initializeMobileMenu();
});

function initializeMobileMenu() {
    const mobileMenu = document.getElementById('mobile-menu');
    const mobileToggle = document.getElementById('mobile-menu-toggle');
    
    if (mobileMenu && mobileToggle) {
        // Mobile menu toggle
        mobileToggle.addEventListener('click', function(event) {
            event.preventDefault();
            event.stopPropagation();
            mobileMenu.classList.toggle('is-visible');
            this.classList.toggle('is-active');
        });
        
        // Close mobile menu when clicking close button
        const closeButton = mobileMenu.querySelector('.close');
        if (closeButton) {
            closeButton.addEventListener('click', function(event) {
                event.preventDefault();
                mobileMenu.classList.remove('is-visible');
                mobileToggle.classList.remove('is-active');
            });
        }
        
        // Close mobile menu when clicking outside
        document.addEventListener('click', function(event) {
            if (!mobileMenu.contains(event.target) && 
                !mobileToggle.contains(event.target)) {
                mobileMenu.classList.remove('is-visible');
                mobileToggle.classList.remove('is-active');
            }
        });
        
        // Close mobile menu on escape key
        document.addEventListener('keydown', function(event) {
            if (event.keyCode === 27) {
                mobileMenu.classList.remove('is-visible');
                mobileToggle.classList.remove('is-active');
            }
        });
        
        // Close mobile menu when clicking on a link
        const menuLinks = mobileMenu.querySelectorAll('a:not(.close)');
        menuLinks.forEach(link => {
            link.addEventListener('click', function() {
                mobileMenu.classList.remove('is-visible');
                mobileToggle.classList.remove('is-active');
            });
        });
    }
}

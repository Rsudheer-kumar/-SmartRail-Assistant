// Show login modal when page loads
document.addEventListener('DOMContentLoaded', () => {
    function getAuthApiBase() {
        const configuredBase = (window.AUTH_API_BASE_URL || '').trim();
        if (configuredBase) {
            return configuredBase.replace(/\/$/, '');
        }

        // Keep local file:// workflow working with a separate auth server.
        if (window.location.protocol === 'file:') {
            return 'http://localhost:5000';
        }

        // In deployment, use same-origin backend.
        return '';
    }

    function buildAuthApiUrl(path) {
        return `${getAuthApiBase()}${path}`;
    }

    const loginModal = document.getElementById('loginModal');
    const updatesModal = document.getElementById('updatesModal');
    const loginBtn = document.getElementById('loginBtn');
    const showUpdatesBtn = document.getElementById('showUpdates');
    const closeButtons = document.querySelectorAll('.close-modal');
    const tabButtons = document.querySelectorAll('.tab-btn');
    const loginForm = document.getElementById('loginForm');
    const signupForm = document.getElementById('signupForm');
    const navLinks = document.querySelector('.nav-links');
    const toggleChatbotBtn = document.getElementById('toggleChatbot');
    const closeChatbotBtn = document.getElementById('closeChatbot');
    const chatbotContainer = document.getElementById('chatbotContainer');

    // Check if user is already logged in
    const token = localStorage.getItem('token');
    if (token) {
        updateNavbarForLoggedInUser();
    }

    // Handle tab switching
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            // Remove active class from all buttons
            tabButtons.forEach(btn => btn.classList.remove('active'));
            // Add active class to clicked button
            button.classList.add('active');
            
            // Show corresponding form
            if (button.dataset.tab === 'login') {
                loginForm.style.display = 'flex';
                signupForm.style.display = 'none';
            } else {
                loginForm.style.display = 'none';
                signupForm.style.display = 'flex';
            }
        });
    });

    // Open login modal when navigated from chatbot back button
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('showLogin') === '1') {
        loginModal.style.display = 'block';
        tabButtons[0].click();
    }

    // Handle signup form submission
    signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = signupForm.querySelector('input[type="text"]').value;
        const email = signupForm.querySelector('input[type="email"]').value;
        const password = signupForm.querySelector('input[type="password"]').value;
        const confirmPassword = signupForm.querySelectorAll('input[type="password"]')[1].value;
        
        if (password !== confirmPassword) {
            alert('Passwords do not match!');
            return;
        }
        
        try {
            const response = await fetch(buildAuthApiUrl('/api/auth/register'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username: name, email, password })
            });

            const data = await response.json();
            
            if (response.ok) {
                // Clear signup form
                signupForm.reset();
                // Switch to login tab
                tabButtons[0].click();
                // Show success message
                alert('Successfully signed up! Please login with your credentials.');
            } else {
                alert(data.message || 'Signup failed. Please try again.');
            }
        } catch (error) {
            console.error('Signup error:', error);
            alert('An error occurred during signup. Please try again.');
        }
    });

    // Handle login form submission
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = loginForm.querySelector('input[type="email"]').value;
        const password = loginForm.querySelector('input[type="password"]').value;
        
        try {
            const response = await fetch(buildAuthApiUrl('/api/auth/login'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email, password })
            });

            const data = await response.json();
            
            if (response.ok) {
                localStorage.setItem('token', data.token);
                updateNavbarForLoggedInUser();
                loginModal.style.display = 'none';
                loginForm.reset();
            } else {
                alert(data.message || 'Login failed. Please try again.');
            }
        } catch (error) {
            console.error('Login error:', error);
            alert('An error occurred during login. Please try again.');
        }
    });

    // Handle login button click
    loginBtn.addEventListener('click', () => {
        loginModal.style.display = 'block';
        // Switch to login tab
        tabButtons[0].click();
    });

    // Handle updates button click
    showUpdatesBtn.addEventListener('click', () => {
        updatesModal.style.display = 'block';
    });

    // Handle close button clicks
    closeButtons.forEach(button => {
        button.addEventListener('click', () => {
            loginModal.style.display = 'none';
            updatesModal.style.display = 'none';
        });
    });

    // Close modals when clicking outside
    window.addEventListener('click', (e) => {
        if (e.target === loginModal) {
            loginModal.style.display = 'none';
        }
        if (e.target === updatesModal) {
            updatesModal.style.display = 'none';
        }
    });

    // Function to update navbar for logged in user
    async function updateNavbarForLoggedInUser() {
        const token = localStorage.getItem('token');
        if (!token) return;

        try {
            const response = await fetch(buildAuthApiUrl('/api/auth/user'), {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.ok) {
                const user = await response.json();
                // Update login button to show user's name
                loginBtn.innerHTML = `<i class="fas fa-user"></i> ${user.username}`;
                loginBtn.classList.add('user-profile');
                
                // Add logout button
                const logoutBtn = document.createElement('button');
                logoutBtn.className = 'logout-button';
                logoutBtn.innerHTML = '<i class="fas fa-sign-out-alt"></i> Logout';
                logoutBtn.addEventListener('click', handleLogout);
                
                // Replace login button with user profile and logout
                const loginBtnContainer = loginBtn.parentElement;
                loginBtnContainer.innerHTML = '';
                loginBtnContainer.appendChild(loginBtn);
                loginBtnContainer.appendChild(logoutBtn);
            }
        } catch (error) {
            console.error('Error fetching user data:', error);
        }
    }

    // Handle logout
    function handleLogout() {
        localStorage.removeItem('token');
        location.reload();
    }

    // Simulate real-time updates
    setInterval(() => {
        const updateTimes = document.querySelectorAll('.update-time');
        updateTimes.forEach(time => {
            const minutes = Math.floor(Math.random() * 15);
            time.textContent = `Last updated: ${minutes} minutes ago`;
        });
    }, 60000); // Update every minute

    // Toggle chatbot visibility
    toggleChatbotBtn.addEventListener('click', () => {
        if (chatbotContainer.style.display === 'block') {
            chatbotContainer.style.display = 'none';
        } else {
            chatbotContainer.style.display = 'block';
        }
    });

    closeChatbotBtn.addEventListener('click', () => {
        chatbotContainer.style.display = 'none';
    });
}); 
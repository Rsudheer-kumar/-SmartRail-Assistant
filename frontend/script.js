document.addEventListener('DOMContentLoaded', function() {
    // DOM Elements
    const chatLog = document.getElementById('chat-log');
    const userInput = document.getElementById('user-input');
    const sendButton = document.getElementById('send-button');
    const newChatBtn = document.getElementById('new-chat-btn');
    const recentChats = document.getElementById('recent-chats');
    const sidebar = document.getElementById('sidebar');
    const mainContent = document.getElementById('main-content');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const chatContainer = document.querySelector('.chat-container');
    const voiceButton = document.getElementById('voice-button');
    const speakResponseButton = document.getElementById('speak-response-button');
    const stopSpeechButton = document.getElementById('stop-speech-button');

    if (!chatLog || !userInput || !sendButton || !newChatBtn || !recentChats || !sidebar || !mainContent || !sidebarToggle || !voiceButton || !speakResponseButton || !stopSpeechButton) {
        return;
    }

    // Chat state
    let sessionId = localStorage.getItem('sessionId') || generateSessionId();
    let currentChat = JSON.parse(localStorage.getItem(`chat-${sessionId}`)) || [];
    let chatHistory = JSON.parse(localStorage.getItem('chatHistory')) || [];
    let typingIndicator = null;
    let recognition = null;
    let lastBotMessage = '';
    let lastTrains = [];
    let lastRoute = null;
    const travelDateStorageKey = 'selectedTravelDate';
    // Chat pacing (ms) - increase to make the bot slower/more deliberate
    const chatPacingDelay = 1100;
    const localResponses = {
        direct_train: [
            "Go to IRCTC or NTES, search your route, and enable the direct train filter.",
            "Search the source and destination on IRCTC, then choose a zero-change train if available.",
            "Use NTES, enter your route, and filter for direct or no-interchange trains.",
            "Check IRCTC, apply the direct train filter, and compare timings before booking."
        ],
        train_time: [
            "Check train timings on IRCTC or NTES by entering your source and destination.",
            "Use the official railway app or NTES to compare departure and arrival times.",
            "Search the route in IRCTC, then review the schedule and live running status.",
            "Look up the train number in NTES for the latest timing details."
        ],
        booking: [
            "You can book tickets directly on the IRCTC website or app.",
            "Open IRCTC, search your route, and complete booking after checking availability.",
            "For booking, use the official railway app and confirm seat availability first.",
            "IRCTC is the safest place to check fares, availability, and booking options."
        ],
        route_help: [
            "Share your source and destination, and I can help you plan the trip step by step.",
            "Tell me your start and end points, and I’ll suggest the best transit option.",
            "Give me the route details and I’ll help compare direct trains, transfers, and timings.",
            "Send the trip details and I’ll format a quick route plan for you."
        ],
        fallback: [
            "I can help with train routes, booking, timings, fares, and direct train checks.",
            "Try asking about direct trains, schedule times, ticket booking, or route planning.",
            "Ask me about train routes, booking, or timings and I’ll guide you step by step.",
            "I’m ready for transit questions like routes, fares, and direct train searches."
        ]
    };

    // Initialize
    initializeChat();
    setupResponsiveSidebar();
    setupVoiceRecognition();

    function setupVoiceRecognition() {
        // Enhanced browser detection including Brave
        const isBrave = navigator.brave && (navigator.brave.isBrave || (() => false))();
        const isChrome = !!window.chrome && (!!window.chrome.webstore || !!window.chrome.runtime) && !isBrave;
        const isEdge = /Edg/.test(navigator.userAgent);
        const isFirefox = typeof InstallTrigger !== 'undefined';
        const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    
        // Check for basic support
        if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
            voiceButton.disabled = true;
            voiceButton.title = "Voice input not supported";
            addMessage("Voice input works best in Chrome, Brave, and Edge browsers", 'bot-message');
            return;
        }
    
        // Initialize recognition
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = 'en-US';
    
        // Browser-specific adjustments
        if (isBrave) {
            // Brave-specific settings
            recognition.lang = 'en-US';
        } else if (isFirefox) {
            recognition.lang = 'en-US';
            recognition.grammars = null;
        } else if (isSafari) {
            recognition.continuous = true;
        }
    
        // Status messages
        const voiceStatus = document.createElement('div');
        voiceStatus.id = 'voice-status';
        voiceStatus.style.cssText = 'margin-left: 80px; color: var(--text-secondary); font-size: 0.8em; display: none;';
        document.querySelector('.input-options').prepend(voiceStatus);
    
        // Event handlers
        recognition.onstart = () => {
            voiceButton.classList.add('listening');
            userInput.placeholder = "Listening...";
            voiceStatus.textContent = "Listening... Speak now";
            voiceStatus.style.display = 'block';
            userInput.value = '';
        };
    
        recognition.onerror = (event) => {
            let errorMessage = "Voice input failed";
            
            // Browser-specific error handling
            if (isBrave) {
                errorMessage = "In Brave: 1) Click the Brave shield icon 2) Set 'Scripts' to 'Allow all' 3) Refresh page";
            } else if (isFirefox) {
                errorMessage = "Firefox requires HTTPS for voice input. Please use Chrome if on HTTP.";
            } else if (isSafari) {
                errorMessage = "Safari has limited voice support. Try longer phrases.";
            }
    
            switch(event.error) {
                case 'network':
                    errorMessage = "Internet connection required for voice input";
                    if (isBrave) {
                        errorMessage += " (Brave may block cloud services. Use Chrome or Edge instead.)";
                    }
                    break;
                case 'not-allowed':
                    if (isBrave) {
                        errorMessage = "Brave blocked microphone. Click the shield icon (🔰) to allow it.";
                    } else if (isFirefox) {
                        errorMessage = "In Firefox: 1) Click the padlock icon 2) Permissions 3) Allow microphone";
                    } else {
                        errorMessage = "Microphone access was blocked. Please allow it.";
                    }
                    break;
            }
    
            voiceStatus.textContent = errorMessage;
            voiceStatus.style.color = '#ff4444';
            voiceButton.classList.remove('listening');
            addMessage(errorMessage, 'bot-error');
        };
    
        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            userInput.value = transcript;
            userInput.focus();
        
            // Move cursor to end of text
            setTimeout(() => {
                userInput.selectionStart = userInput.selectionEnd = userInput.value.length;
            }, 0);
        };
    
        recognition.onend = () => {
            voiceButton.classList.remove('listening');
            userInput.placeholder = "Ask Chatbot";
            voiceStatus.style.display = 'none';
        };
    
        // Modified click handler with Brave-specific checks
        voiceButton.addEventListener('click', async () => {
            if (voiceButton.classList.contains('listening')) {
                recognition.stop();
                return;
            }
    
            try {
                // Special handling for Brave's privacy protections
                if (isBrave) {
                    try {
                        const permissionStatus = await navigator.permissions.query({ name: 'microphone' });
                        if (permissionStatus.state === 'denied') {
                            addMessage("Brave has permanently blocked microphone. Change in settings.", 'bot-error');
                            return;
                        }
                    } catch (e) {
                        console.log("Permissions API not available");
                    }
                }
    
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                stream.getTracks().forEach(track => track.stop());
                recognition.start();
            } catch (err) {
                let helpText = "Microphone access denied";
                if (isBrave) {
                    helpText += ". In Brave: 1) Click the shield icon (🔰) 2) Allow scripts 3) Refresh page";
                } else if (isFirefox) {
                    helpText += ". In Firefox, refresh the page after granting permission.";
                }
                addMessage(helpText, 'bot-error');
            }
        });
    }

    function speakText(text) {
        if (!('speechSynthesis' in window)) {
            console.warn('Text-to-speech not supported in this browser');
            return;
        }

        // Cancel any ongoing speech
        window.speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1;
        utterance.pitch = 1;
        utterance.volume = 1;
        speakResponseButton.style.display = 'none';
        stopSpeechButton.style.display = 'flex';
        stopSpeechButton.classList.add('active');
    
        utterance.onend = () => {
        // When speech ends, show speak button and hide stop button
            stopSpeechButton.style.display = 'none';
            speakResponseButton.style.display = 'flex';
            stopSpeechButton.classList.remove('active');
        };
    
        utterance.onerror = () => {
            // If there's an error, reset the buttons
            stopSpeechButton.style.display = 'none';
            speakResponseButton.style.display = 'flex';
            stopSpeechButton.classList.remove('active');
        };
        window.speechSynthesis.speak(utterance);
    }

    stopSpeechButton.addEventListener('click', () => {
        window.speechSynthesis.cancel();
        stopSpeechButton.style.display = 'none';
        speakResponseButton.style.display = 'flex';
        stopSpeechButton.classList.remove('active');
    });

    function generateSessionId() {
        return Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
    }

    function parseRouteFromText(text) {
        const normalized = String(text || '');
        const fromToMatch = normalized.match(/\bfrom\s+([a-zA-Z\s]+?)\s+to\s+([a-zA-Z\s]+)/i);
        if (fromToMatch) {
            return {
                source: fromToMatch[1].trim(),
                destination: fromToMatch[2].trim()
            };
        }

        const simpleMatch = normalized.match(/\b([a-zA-Z][a-zA-Z\s]{1,60}?)\s+to\s+([a-zA-Z][a-zA-Z\s]{1,60})\b/i);
        if (simpleMatch) {
            return {
                source: simpleMatch[1].trim(),
                destination: simpleMatch[2].trim()
            };
        }

        return null;
    }

    function getStoredRouteContext() {
        try {
            const stored = localStorage.getItem('selectedRouteContext');
            return stored ? JSON.parse(stored) : null;
        } catch (error) {
            return null;
        }
    }

    function storeRouteContextFromText(text) {
        const route = parseRouteFromText(text);
        if (route?.source && route?.destination) {
            localStorage.setItem('selectedRouteContext', JSON.stringify(route));
            return route;
        }

        return null;
    }

    function serializeChatMessages(messages) {
        return messages.map(message => ({
            sender: message.type && message.type.startsWith('user') ? 'user' : 'bot',
            text: message.content,
            time: message.time || new Date().toISOString()
        }));
    }

    async function saveChatToMongo() {
        if (currentChat.length === 0) {
            return;
        }

        try {
            await fetch(getChatSaveEndpoint(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId,
                    messages: serializeChatMessages(currentChat),
                    lastRoute: lastRoute || {}
                })
            });
        } catch (error) {
            console.warn('Save chat failed', error);
        }
    }

    function offlineIncludesAny(text, keywords) {
        return keywords.some(keyword => {
            if (keyword.includes(' ') || keyword.includes('-')) {
                return text.includes(keyword);
            }

            const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return new RegExp(`(^|\\W)${escapedKeyword}(\\W|$)`, 'i').test(text);
        });
    }

    function randomChoice(items) {
        return items[Math.floor(Math.random() * items.length)];
    }

    function detectIntent(message) {
        const text = (message || '').toLowerCase();

        if (text.includes('direct') || text.includes('non stop') || text.includes('non-stop') || text.includes('zero change') || text.includes('zero-change')) {
            return 'direct_train';
        }

        if (text.includes('time') || text.includes('schedule') || text.includes('arrival') || text.includes('departure')) {
            return 'train_time';
        }

        if (text.includes('ticket') || text.includes('book') || text.includes('booking')) {
            return 'booking';
        }

        if (text.includes('route') || text.includes('plan') || text.includes('from') || text.includes('to')) {
            return 'route_help';
        }

        return 'fallback';
    }

    function isOfflineGreeting(text) {
        return /^(hi+|hello+|hey+|namaste|help)\b/i.test(text.trim());
    }

    function extractOfflineRoute(message) {
        const text = message || '';
        const match = text.match(/from\s+([a-zA-Z\s]+?)\s+to\s+([a-zA-Z\s]+)/i)
            || text.match(/^([a-zA-Z][a-zA-Z\s]{1,40}?)\s+to\s+([a-zA-Z][a-zA-Z\s]{1,40})$/i);

        if (!match) {
            return { source: '', destination: '' };
        }

        const cleanPlace = value => value
            .replace(/\b(my|the|is|at|to|from|and|destination|start|source)\b/gi, '')
            .replace(/\b(with|by|using|via|for|including|fare|price|cost|timing|time|schedule|train|bus|metro|route|plan)\b.*$/gi, '')
            .replace(/[^a-zA-Z\s]/g, '')
            .trim();

        return {
            source: cleanPlace(match[1]),
            destination: cleanPlace(match[2])
        };
    }

const offlineDistances = {
        'hyderabad-delhi': 1550,
        'delhi-hyderabad': 1550,
        'delhi-phagwara': 350,
        'phagwara-delhi': 350,
        'mumbai-delhi': 1400,
        'delhi-mumbai': 1400,
        'hyderabad-mumbai': 750,
        'mumbai-hyderabad': 750,
        'bangalore-delhi': 2150,
        'delhi-bangalore': 2150,
        'hyderabad-bangalore': 570,
        'bangalore-hyderabad': 570,
        'hyderabad-phagwara': 1800,
        'phagwara-hyderabad': 1800,
        'phagwara-nallagandla': 1850,
        'nallagandla-phagwara': 1850,
        'phagwara-lingampalli': 1850,
        'lingampalli-phagwara': 1850,
        'mumbai-bangalore': 980,
        'bangalore-mumbai': 980,
        // NEW DISTANCES
        'delhi-kochi': 2600,
        'kochi-delhi': 2600,
        'delhi-nagpur': 980,
        'nagpur-delhi': 980,
        'bangalore-kochi': 560,
        'kochi-bangalore': 560,
        'delhi-chennai': 2200,
        'chennai-delhi': 2200,
        'mumbai-chennai': 1280,
        'chennai-mumbai': 1280,
        'bangalore-chennai': 350,
        'chennai-bangalore': 350,
        'hyderabad-chennai': 630,
        'chennai-hyderabad': 630,
        'mumbai-pune': 150,
        'pune-mumbai': 150,
        'delhi-pune': 1500,
        'pune-delhi': 1500,
        'delhi-jaipur': 280,
        'jaipur-delhi': 280,
        'hyderabad-pune': 660,
        'pune-hyderabad': 660
    };

    function getOfflineRouteKey(source, destination) {
        const aliases = {
            nallagandla: 'nallagandla',
            'nalla gandla': 'nallagandla',
            lingampalli: 'nallagandla',
            lingampally: 'nallagandla'
        };
        const normalize = place => {
            const clean = String(place || '').toLowerCase().trim();
            return aliases[clean] || clean;
        };
        return `${normalize(source)}-${normalize(destination)}`;
    }

    function calculateOfflineTravelTime(distance) {
        const minHours = Math.floor(distance / 70);
        const maxHours = Math.ceil(distance / 60);
        return `${minHours}-${maxHours} hours`;
    }

    function estimateOfflineFare(distance) {
        return {
            sleeper: Math.round(distance * 0.5),
            ac: Math.round(distance * 1.2)
        };
    }

    function buildPhagwaraNallagandlaOfflinePlan(route) {
        const key = getOfflineRouteKey(route.source, route.destination);
        if (key !== 'phagwara-nallagandla' && key !== 'nallagandla-phagwara') {
            return '';
        }

        const reverse = key === 'nallagandla-phagwara';
        const source = reverse ? 'Nallagandla' : 'Phagwara';
        const destination = reverse ? 'Phagwara' : 'Nallagandla';
        const distance = offlineDistances[key] || 1850;
        const fare = estimateOfflineFare(distance);
        const mainLeg = reverse
            ? 'Use Lingampalli (LPI), Hyderabad (HYB), or Secunderabad (SC) as the boarding station, then travel north toward Delhi/Jalandhar/Phagwara.'
            : 'Search Phagwara (PGW) to Lingampalli (LPI), Hyderabad (HYB), or Secunderabad (SC). Nallagandla is a Hyderabad locality, so Lingampalli is the closest practical rail target.';
        const altLeg = reverse
            ? 'If a direct south-to-Phagwara train is not available, take Hyderabad/Secunderabad to New Delhi, then New Delhi to Phagwara.'
            : 'If a direct PGW to Hyderabad/LPI train is not available, take Phagwara to New Delhi first, then New Delhi to Hyderabad/Secunderabad, and finish by MMTS/cab to Lingampalli/Nallagandla.';

        return [
            `Route plan: ${source} to ${destination}`,
            '',
            `Distance: ~${distance} km | Duration: ${calculateOfflineTravelTime(distance)}`,
            `Fare estimate: Sleeper Rs ${fare.sleeper}, AC Rs ${fare.ac}`,
            '',
            'Direct train check:',
            'No reliable direct train should be assumed for Phagwara to Nallagandla because Nallagandla is not the long-distance railway endpoint.',
            mainLeg,
            '',
            'Best train alternative:',
            `1) ${altLeg}`,
            '2) Check these station pairs on IRCTC/NTES: PGW to LPI, PGW to HYB, PGW to SC, and PGW to NDLS plus NDLS to HYB/SC.',
            '3) After reaching Lingampalli or Hyderabad/Secunderabad, take MMTS, metro plus auto, or cab to Nallagandla.',
            '',
            'Suggested trains to compare:',
            '- Phagwara to New Delhi: Shatabdi/Jhelum/Sachkhand type options depending on date.',
            '- New Delhi to Hyderabad/Secunderabad: Telangana Express or Dakshin Express type options.',
            '',
            'Always verify live train availability, running status, and platform on IRCTC or NTES before booking.'
        ].join('\n');
    }

const offlineDirectRoutes = new Set([
        'hyderabad-delhi',
        'delhi-hyderabad',
        'delhi-phagwara',
        'phagwara-delhi',
        'mumbai-delhi',
        'delhi-mumbai',
        'hyderabad-mumbai',
        'mumbai-hyderabad',
        // NEW DIRECT ROUTES
        'delhi-kochi',
        'kochi-delhi',
        'delhi-bangalore',
        'bangalore-delhi',
        'delhi-nagpur',
        'nagpur-delhi',
        'bangalore-kochi',
        'kochi-bangalore',
        'delhi-chennai',
        'chennai-delhi',
        'bangalore-chennai',
        'chennai-bangalore',
        'mumbai-chennai',
        'chennai-mumbai'
    ]);

// Smart train fallback - guess expected trains based on distance
function guessOfflineTrains(distance) {
        if (!distance || distance === 0) {
            return ["Intercity Express", "Passenger Train"];
        }
        if (distance < 800) {
            return ["Shatabdi Express", "Intercity Express", "Superfast Express"];
        }
        if (distance < 1500) {
            return ["Rajdhani Express", "Duronto Express", "Superfast Express"];
        }
        return ["Rajdhani Express", "Shatabdi Express", "Duronto Express"];
    }

    function generateOfflineTips(distance, hasDirectTrain) {
        const tips = [];

        if (hasDirectTrain) {
            tips.push('Direct train data is available for this route, so prefer a direct train for convenience.');
        } else {
            // Smart fallback - show expected trains instead of saying no data
            const expectedTrains = guessOfflineTrains(distance);
            tips.push('Direct trains are likely available. Check IRCTC/NTES for live availability.');
            tips.push(`Expected trains: ${expectedTrains.join(", ")}`);
        }

        if (distance > 1000) {
            tips.push('This is a long journey, so choose Sleeper or AC based on budget and comfort.');
        } else if (distance > 500) {
            tips.push('This is a medium-distance route, so compare overnight trains with daytime chair-car options.');
        } else {
            tips.push('This is a shorter route, so seating class or chair car may be enough.');
        }

        tips.push('Always verify live running status, platform, and seat availability on IRCTC or NTES before departure.');
        return tips;
    }

    function getOfflineRouteFacts(route) {
        if (!route.source || !route.destination) {
            return {
                distanceLine: '',
                durationLine: 'Estimated duration: verify using IRCTC/NTES.',
                fareLines: ['Fare estimate: verify current fare on IRCTC by train class.'],
                tipLines: ['Suggestions:', '1) Check direct trains first.', '2) Compare duration, fare, and transfer count before booking.']
            };
        }

        const routeKey = getOfflineRouteKey(route.source, route.destination);
        const distance = offlineDistances[routeKey];
        if (!distance) {
            return {
                distanceLine: 'Distance: verify using IRCTC/NTES or a route planner.',
                durationLine: 'Estimated duration: verify using IRCTC/NTES.',
                fareLines: ['Fare estimate: verify current fare on IRCTC by train class.'],
                tipLines: ['Suggestions:', '1) Check direct trains first.', '2) Compare duration, fare, and transfer count before booking.']
            };
        }

        const fare = estimateOfflineFare(distance);
        const hasDirectTrain = offlineDirectRoutes.has(routeKey);
        const tips = generateOfflineTips(distance, hasDirectTrain);

        return {
            distanceLine: `Distance: ${distance} km.`,
            durationLine: `Estimated duration: ${calculateOfflineTravelTime(distance)}.`,
            fareLines: ['Fare estimate:', `- Sleeper: Rs ${fare.sleeper}`, `- AC: Rs ${fare.ac}`],
            tipLines: ['Suggestions:', ...tips.map((tip, index) => `${index + 1}) ${tip}`)]
        };
    }

    // Parse hour from train string like "(21:00 → 04:30" or "21:00 →"
    function parseTrainStartHour(trainStr) {
        if (!trainStr || typeof trainStr !== 'string') return null;
        // Try 24-hour time like 21:30 or 9:05
        const m24 = trainStr.match(/(\d{1,2}):(\d{2})/);
        if (m24) {
            const h = Number(m24[1]);
            if (!Number.isNaN(h)) return h;
        }

        // Try patterns with AM/PM, e.g., 9:30 AM or 9 AM
        const mampm = trainStr.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i);
        if (mampm) {
            let hour = Number(mampm[1]);
            const period = mampm[3].toUpperCase();
            if (period === 'PM' && hour < 12) hour += 12;
            if (period === 'AM' && hour === 12) hour = 0;
            return hour;
        }

        return null;
    }

    function filterTrainsByPreference(trains, preference) {
        if (!Array.isArray(trains) || trains.length === 0) return [];
        const pref = (preference || '').toLowerCase();

        const isMatch = (hour) => {
            if (hour === null) return false;
            if (pref === 'morning') return hour >= 5 && hour < 12;
            if (pref === 'afternoon') return hour >= 12 && hour < 17;
            if (pref === 'evening') return hour >= 17 && hour < 21;
            if (pref === 'night') return (hour >= 21 && hour <= 23) || (hour >= 0 && hour < 5);
            return false;
        };

        const withHours = trains.map(t => {
            const raw = typeof t === 'string' ? t : (t.train_name ? `${t.train_name} ${t.train_number || ''}` : JSON.stringify(t));
            const hour = parseTrainStartHour(raw);
            console.log('filterTrainsByPreference parsed:', raw, '=>', hour);
            return { raw, hour };
        });

        const matched = withHours.filter(w => isMatch(w.hour)).map(w => w.raw);
        if (matched.length) {
            console.log('filterTrainsByPreference matched:', matched);
            return matched;
        }

        console.log('filterTrainsByPreference no exact matches, fallback to first 3');
        return withHours.slice(0, 3).map(w => w.raw);
    }

// ==========================
    // FULL LOGIC: SMART TRAIN RECOMMENDATIONS
    // ==========================
    
    // Parse train string to extract price and duration for comparison
    function parseTrainData(trainStr) {
        if (!trainStr || typeof trainStr !== 'string') {
            return { price: 9999, duration: 99, name: 'Unknown' };
        }
        
        // Extract price from fare like "₹850" or "₹300 (SL)"
        const priceMatch = trainStr.match(/₹(\d+(?:,\d+)?)/);
        const price = priceMatch ? Number(priceMatch[1].replace(/,/g, '')) : 1000;
        
        // Extract duration from strings like "(6h)" or "6 hours"
        const durationMatch = trainStr.match(/(\d+)\s*h(?:\s*ours?)?/i);
        const duration = durationMatch ? Number(durationMatch[1]) : 8;
        
        return { price, duration, name: trainStr };
    }
    
    // Get food availability info based on train type and duration
    function getFoodInfo(trainStr) {
        if (!trainStr || typeof trainStr !== 'string') {
            return '❓ Food: Check details';
        }
        
        const name = trainStr.toLowerCase();
        
        // Premium trains with included food
        if (name.includes('rajdhani') || name.includes('shatabdi') || name.includes('duronto')) {
            return '🍱 Food: Included in ticket';
        }
        
        // Extract duration to check if long journey
        const durationMatch = trainStr.match(/(\d+)\s*h(?:\s*ours?)?/i);
        const duration = durationMatch ? Number(durationMatch[1]) : 0;
        
        // Long journey (>= 12 hours)
        if (duration >= 12) {
        if (duration > 20) {
                return '🍴 Food: Available (paid) 🥗 E-catering available | 💡 Carry extra food';
            }
            return '🍴 Food: Available (paid) 🥗 E-catering available';
        }
        
        // Short journey
        return '❌ Food: Not available 🥗 E-catering available for long routes';
    }
    
    // Find cheapest and fastest trains from the list
    function getBestTrains(trains) {
        if (!Array.isArray(trains) || trains.length === 0) {
            return { cheapest: null, fastest: null };
        }
        
        const parsed = trains.map(t => ({
            train: t,
            ...parseTrainData(typeof t === 'string' ? t : JSON.stringify(t))
        }));
        
        const cheapest = parsed.reduce((a, b) => a.price < b.price ? a : b);
        const fastest = parsed.reduce((a, b) => a.duration < b.duration ? a : b);
        
        return { cheapest: cheapest.train, fastest: fastest.train };
    }
    
    // Get smart recommendation considering both price and duration
    function getSmartRecommendation(trains) {
        if (!Array.isArray(trains) || trains.length === 0) {
            return null;
        }
        
        const parsed = trains.map(t => ({
            train: t,
            ...parseTrainData(typeof t === 'string' ? t : JSON.stringify(t))
        }));
        
        // Score: lower is better (price + duration * 50 gives weight to time)
        return parsed.reduce((a, b) => 
            (a.price + a.duration * 50) < (b.price + b.duration * 50) ? a : b
        ).train;
    }
    
    // Generate reasons why a train is recommended
    function getWhy(train, trains) {
        const reasons = [];
        if (!train || !Array.isArray(trains)) return reasons;
        
        const parsed = trains.map(t => ({
            ...parseTrainData(typeof t === 'string' ? t : JSON.stringify(t))
        }));
        
        const prices = parsed.map(p => p.price);
        const durations = parsed.map(p => p.duration);
        
        const trainData = parseTrainData(train);
        
        if (trainData.price === Math.min(...prices)) {
            reasons.push("Affordable price");
        }
        if (trainData.duration === Math.min(...durations)) {
            reasons.push("Faster than others");
        }
        
        // Check for good departure time
        const hourMatch = String(train).match(/Dep:\s*(\d{1,2}):/);
        if (hourMatch) {
            const hour = Number(hourMatch[1]);
            if (hour >= 18 && hour <= 21) {
                reasons.push("Good evening departure");
            } else if (hour >= 21 || hour < 5) {
                reasons.push("Night train - sleep while traveling");
            }
        }
        
        return reasons;
    }
    
    // Filter trains by time preference (morning/evening/night)
    function filterByTime(trains, pref) {
        if (!Array.isArray(trains) || trains.length === 0) return [];
        const prefLower = (pref || '').toLowerCase();
        
        const isMatch = (hour) => {
            if (hour === null) return false;
            if (prefLower === 'morning') return hour >= 5 && hour < 12;
            if (prefLower === 'afternoon') return hour >= 12 && hour < 17;
            if (prefLower === 'evening') return hour >= 17 && hour < 21;
            if (prefLower === 'night') return (hour >= 21 && hour <= 23) || (hour >= 0 && hour < 5);
            return true;
        };
        
        const withHours = trains.map(t => {
            const trainStr = typeof t === 'string' ? t : JSON.stringify(t);
            const hourMatch = trainStr.match(/Dep:\s*(\d{1,2}):/);
            const hour = hourMatch ? Number(hourMatch[1]) : null;
            return { train: t, hour };
        });
        
        const matched = withHours.filter(w => isMatch(w.hour)).map(w => w.train);
        
        // If no exact match, return first 3 trains
        return matched.length > 0 ? matched : trains.slice(0, 3);
    }
    
    // Build enhanced response with smart recommendations
    function buildSmartTrainResponse(trains, route, distance) {
        if (!Array.isArray(trains) || trains.length === 0) {
            return "No trains available for this route.";
        }
        
        const fare = estimateFare(distance || 0);
        const duration = distance ? `${Math.ceil(distance / 65)}-${Math.ceil(distance / 55)} hours` : 'verify using IRCTC/NTES';
        
        let response = `Route: ${route.source} → ${route.destination}\n\n`;
        response += `Distance: ${distance ? `${distance} km` : 'verify using IRCTC/NTES'}\n`;
        response += `Estimated duration: ${duration}\n`;
        response += `Fare estimate: Sleeper Rs ${fare.sleeper}, AC Rs ${fare.ac}\n\n`;
        response += `🗓️ Select your travel date to see all trains for this route.`;
        
        return response;
    }

    // ==========================
    // 1. EXTRACT SOURCE & DEST
    // ==========================
    function extractStations(input) {
        input = input.toLowerCase();
        let match = input.match(/from (.+?) to (.+)/) || input.match(/(.+?) to (.+)/);
        
        if (match) {
            return {
                source: match[1].trim(),
                destination: match[2].trim()
            };
        }
        return null;
    }

    // ==========================
    // 2. STATE HANDLING
    // ==========================
    const states = {
        "kerala": ["kochi", "trivandrum", "ernakulam"],
        "andhra pradesh": ["vijayawada", "visakhapatnam"],
        "karnataka": ["bangalore", "mysore"],
        "tamil nadu": ["chennai", "madurai"]
    };

    // ==========================
    // 3. STATION CODES
    // ==========================
const stationCodes = {
        "delhi": "NDLS",
        "nagpur": "NGP",
        "bangalore": "SBC",
        "hyderabad": "HYB",
        "mumbai": "CST",
        "chennai": "MAS",
        "pune": "PUNE",
        "jaipur": "JP",
        "bhopal": "BPL",
        "phagwara": "PGW",
        "nallagandla": "LPI",
        "lingampalli": "LPI",
        "lingampally": "LPI",
        "kochi": "ERS",
        "trivandrum": "TVC",
        "ernakulam": "ERS",
        "vijayawada": "BZA",
        "visakhapatnam": "VSKP",
        "mysore": "MYS",
        "madurai": "MDU"
    };

    function getCode(city) {
        return stationCodes[city.toLowerCase()];
    }

// ==========================
    // 4. DISTANCE (fallback)
    // ==========================
    function estimateDistance(src, dest) {
        const map = {
            "delhi-bangalore": 2150,
            "delhi-nagpur": 980,
            "delhi-hyderabad": 1550,
            "delhi-mumbai": 1400,
            "delhi-phagwara": 350,
            "mumbai-bangalore": 980,
            "hyderabad-bangalore": 570,
            "phagwara-nallagandla": 1850,
            "nallagandla-phagwara": 1850,
            "phagwara-lingampalli": 1850,
            "lingampalli-phagwara": 1850,
            // NEW DISTANCES
            "delhi-kochi": 2600,
            "kochi-delhi": 2600,
            "delhi-nagpur": 980,
            "nagpur-delhi": 980,
            "bangalore-kochi": 560,
            "kochi-bangalore": 560,
            "delhi-chennai": 2200,
            "chennai-delhi": 2200,
            "mumbai-chennai": 1280,
            "chennai-mumbai": 1280,
            "bangalore-chennai": 350,
            "chennai-bangalore": 350,
            "hyderabad-chennai": 630,
            "chennai-hyderabad": 630,
            "mumbai-pune": 150,
            "pune-mumbai": 150,
            "delhi-pune": 1500,
            "pune-delhi": 1500,
            "delhi-jaipur": 280,
            "jaipur-delhi": 280,
            "hyderabad-pune": 660,
            "pune-hyderabad": 660
        };

        let key = `${src}-${dest}`;
        let reverse = `${dest}-${src}`;

        return map[key] || map[reverse] || 1200;
    }

    // ==========================
    // 5. FETCH REAL TRAIN DATA
    // ==========================
    async function fetchTrains(src, dest) {
        const routeKey = `${src.toLowerCase()}-${dest.toLowerCase()}`;
        
        const mockDatabase = {
            "delhi-phagwara": [
                "Shatabdi Exp (12013) - Dep: 16:30 Arr: 21:30 | Fare: ₹850 (CC)",
                "Jhelum Express (11077) - Dep: 21:00 Arr: 03:20 | Fare: ₹300 (SL), ₹800 (3A)",
                "Sachkhand Exp (12715) - Dep: 13:20 Arr: 18:40 | Fare: ₹350 (SL), ₹900 (3A)"
            ],
            "hyderabad-mumbai": [
                "Hussainsagar Exp (12702) - Dep: 14:50 Arr: 04:55 | Fare: ₹450 (SL), ₹1200 (3A)",
                "Mumbai Express (17032) - Dep: 20:40 Arr: 13:05 | Fare: ₹400 (SL), ₹1100 (3A)",
                "Shatabdi Exp (12026) - Dep: 15:00 Arr: 23:55 | Fare: ₹1300 (CC)"
            ],
            "delhi-mumbai": [
                "Rajdhani Exp (12952) - Dep: 16:55 Arr: 08:35 | Fare: ₹2800 (3A)",
                "Paschim Exp (12926) - Dep: 16:30 Arr: 14:55 | Fare: ₹650 (SL), ₹1700 (3A)",
                "AK Tejas Raj (12954) - Dep: 17:15 Arr: 10:05 | Fare: ₹2900 (3A)"
            ],
            "bangalore-delhi": [
                "Karnataka Exp (12627) - Dep: 19:20 Arr: 09:00 | Fare: ₹900 (SL), ₹2300 (3A)",
                "Rajdhani Exp (22691) - Dep: 20:00 Arr: 05:30 | Fare: ₹3500 (3A)"
            ],
            "hyderabad-delhi": [
                "Telangana Exp (12723) - Dep: 06:25 Arr: 07:40 | Fare: ₹700 (SL), ₹1800 (3A)",
                "Dakshin Exp (12721) - Dep: 23:00 Arr: 04:00 | Fare: ₹650 (SL), ₹1700 (3A)"
            ],
            "hyderabad-bangalore": [
                "KCG YPR Exp (17603) - Dep: 21:05 Arr: 09:35 | Fare: ₹400 (SL), ₹1050 (3A)",
                "SBC Rajdhani (22692) - Dep: 19:50 Arr: 05:20 | Fare: ₹1800 (3A)"
            ],
            "delhi-kochi": [
                "Kerala Exp (12626) - Dep: 20:10 Arr: 14:25 | Fare: ₹1050 (SL), ₹2700 (3A)",
                "Mangala Ldweep (12618) - Dep: 05:40 Arr: 07:30 | Fare: ₹1000 (SL), ₹2600 (3A)"
            ],
            "delhi-nagpur": [
                "Grand Trunk Exp (12616) - Dep: 16:10 Arr: 10:15 | Fare: ₹500 (SL), ₹1300 (3A)",
                "AP Express (20806) - Dep: 20:00 Arr: 13:00 | Fare: ₹550 (SL), ₹1400 (3A)"
            ],
            "bangalore-kochi": [
                "Kanyakumari Exp (16526) - Dep: 20:10 Arr: 07:10 | Fare: ₹350 (SL), ₹900 (3A)",
                "Kochuveli Exp (16315) - Dep: 16:50 Arr: 04:00 | Fare: ₹330 (SL), ₹850 (3A)"
            ],
            "delhi-chennai": [
                "Tamil Nadu Exp (12622) - Dep: 21:05 Arr: 06:15 | Fare: ₹900 (SL), ₹2300 (3A)",
                "Grand Trunk Exp (12616) - Dep: 16:10 Arr: 04:30 | Fare: ₹850 (SL), ₹2200 (3A)"
            ],
            "mumbai-chennai": [
                "CSMT Chennai Exp (22159) - Dep: 12:45 Arr: 10:45 | Fare: ₹600 (SL), ₹1550 (3A)",
                "LTT Chennai Exp (12163) - Dep: 18:40 Arr: 16:30 | Fare: ₹580 (SL), ₹1500 (3A)"
            ],
            "bangalore-chennai": [
                "Shatabdi Exp (12028) - Dep: 06:00 Arr: 11:00 | Fare: ₹850 (CC)",
                "Brindavan Exp (12640) - Dep: 15:10 Arr: 21:10 | Fare: ₹200 (2S), ₹700 (CC)"
            ],
            "hyderabad-chennai": [
                "Charminar Exp (12760) - Dep: 18:00 Arr: 07:00 | Fare: ₹450 (SL), ₹1150 (3A)",
                "Chennai Exp (12604) - Dep: 16:45 Arr: 05:40 | Fare: ₹420 (SL), ₹1100 (3A)"
            ],
            "mumbai-pune": [
                "Deccan Queen (12123) - Dep: 17:10 Arr: 20:25 | Fare: ₹150 (2S), ₹550 (CC)",
                "Sinhagad Exp (11009) - Dep: 17:50 Arr: 21:50 | Fare: ₹120 (2S), ₹450 (CC)"
            ],
            "delhi-pune": [
                "Jhelum Express (11078) - Dep: 10:30 Arr: 16:00 | Fare: ₹650 (SL), ₹1750 (3A)",
                "Goa Express (12780) - Dep: 15:15 Arr: 17:10 | Fare: ₹700 (SL), ₹1800 (3A)"
            ],
            "delhi-jaipur": [
                "Ajmer Shatabdi (12015) - Dep: 06:10 Arr: 10:40 | Fare: ₹650 (CC)",
                "Double Decker (12986) - Dep: 17:35 Arr: 22:05 | Fare: ₹550 (CC)"
            ],
            "hyderabad-pune": [
                "Hussainsagar Exp (12702) - Dep: 14:50 Arr: 01:00 | Fare: ₹380 (SL), ₹1000 (3A)",
                "Shatabdi Exp (12026) - Dep: 15:00 Arr: 23:10 | Fare: ₹1100 (CC)"
            ]
        };

        const reverseMockDatabase = {};
        for (const [key, value] of Object.entries(mockDatabase)) {
            const [s, d] = key.split('-');
            reverseMockDatabase[`${d}-${s}`] = value.map(train => {
                return train.replace(/Dep: (\d{2}:\d{2}) Arr: (\d{2}:\d{2})/, (m, dep, arr) => `Dep: ${arr} Arr: ${dep}`);
            });
        }
        
        const combinedDatabase = { ...mockDatabase, ...reverseMockDatabase };

        // Simulate network delay
        await new Promise(resolve => setTimeout(resolve, 800));

        if (combinedDatabase[routeKey]) {
            return combinedDatabase[routeKey];
        }

        const distance = estimateDistance(src, dest);
        const duration = Math.ceil(distance / 60);
        const starts = [6, 14, 21];
        const names = ['Express', 'Superfast', 'Rajdhani'];

        return names.map((name, index) => {
            const startHour = starts[index];
            const endHour = (startHour + duration) % 24;
            const dayOffset = Math.floor((startHour + duration) / 24);
            const fare = Math.round(500 + distance * 0.8 + index * 250);

            return `${name} (${10000 + index * 1111}) - Dep: ${String(startHour).padStart(2, '0')}:00 Arr: ${String(endHour).padStart(2, '0')}:00${dayOffset ? `+${dayOffset}` : ''} | Duration: ${duration}h | Fare: Rs ${fare}`;
        });

        // Generic fallback if route not in mock DB
        return [
            `Rajdhani Express (22691) - Dep: 20:00 Arr: 05:30 | Fare: ₹3500 (3A)`,
            `Shatabdi Express (12028) - Dep: 06:00 Arr: 11:00 | Fare: ₹850 (CC)`,
            `Duronto Express (12284) - Dep: 21:45 Arr: 07:15 | Fare: ₹2800 (3A)`
        ];
    }

    // ==========================
    // 6. MAIN BOT FUNCTION
    // ==========================
// Smart time suggestion based on distance
    function suggestBestTime(distance) {
        if (!distance || distance === 0) return "";
        
        if (distance < 800) {
            return "👉 Short trip: Morning or Evening is best.";
        }
        if (distance < 1500) {
            return "👉 Medium trip: Evening or Night is comfortable.";
        }
        return "👉 Long trip: Night travel is best (sleep saves time).";
    }

    async function getBotResponse(input) {
        input = input.toLowerCase().trim();

        if (input === 'hi' || input === 'hello' || input === 'hii') {
            handleGreeting();
            return null;
        }

        // If user answered a time preference (morning/afternoon/evening/night)
        const prefMatch = input.match(/\b(morning|afternoon|evening|night)\b/i);
        if (prefMatch && lastRoute && Array.isArray(lastTrains) && lastTrains.length) {
            console.log("NEW FLOW RUNNING - handling time preference", prefMatch[1]);
            const preference = prefMatch[1].toLowerCase();
            const filtered = filterTrainsByPreference(lastTrains, preference);
            if (filtered.length === 0) {
                return `No specific ${preference} trains found — here are some options:\n${lastTrains.slice(0,3).map((t,i)=>`${i+1}) ${t}\n${getFoodInfo(t)}`).join('\n')}`;
            }
            const trainLines = filtered.map((t,i) => {
                const foodInfo = getFoodInfo(t);
                return `${i+1}) ${t}\n${foodInfo}`;
            }).join('\n\n');
            return `Trains for ${preference.charAt(0).toUpperCase() + preference.slice(1)} travel (${lastRoute.source} → ${lastRoute.destination}):\n${trainLines}`;
        }

        let stations = extractStations(input);

        if (!stations) {
            return "Please enter route like: Delhi to Mumbai";
        }

        let { source, destination } = stations;

        // Handle state input - ask for city when state is mentioned
        if (states[destination]) {
            return `${destination} has multiple stations: ${states[destination].join(", ")}. Please specify which city?`;
        }

        const specialPlan = buildPhagwaraNallagandlaOfflinePlan({ source, destination });
        if (specialPlan) {
            lastRoute = { source, destination };
            lastTrains = [];
            return specialPlan;
        }

        let distance = estimateDistance(source, destination);
        console.log("FULL LOGIC - building route response", source, destination);
        let trains = await fetchTrains(source, destination);
        // store for later preference filtering
        lastTrains = trains || [];
        lastRoute = { source, destination };

        // Use FULL LOGIC smart train response
        return buildSmartTrainResponse(trains, { source, destination }, distance);
    }

    function buildOfflineTransitResponse(message) {
        // Fallback for when API is not used
        return getBotResponse(message).then(res => res).catch(() => randomChoice(localResponses.fallback));
    }

    function getChatEndpoint() {
        if (window.location.protocol === 'file:') {
            return 'http://localhost:3000/api/smart-train-assistant';
        }

        return '/api/smart-train-assistant';
    }

    function getChatSaveEndpoint() {
        if (window.location.protocol === 'file:') {
            return 'http://localhost:3000/api/chats';
        }

        return '/api/chats';
    }

    function initializeChat() {
        const originalLength = currentChat.length;
        currentChat = currentChat.filter(msg => msg.type !== 'bot-error');

        if (currentChat.length !== originalLength) {
            localStorage.setItem(`chat-${sessionId}`, JSON.stringify(currentChat));
        }

        chatLog.innerHTML = '';
        if (currentChat.length > 0) {
            currentChat.forEach(msg => addMessage(msg.content, msg.type));
            // Store the last bot message for voice response
            const lastBotMsg = currentChat.filter(msg => msg.type === 'bot-message').pop();
            lastBotMessage = lastBotMsg ? lastBotMsg.content : '';
        } else {
            showWelcomeMessage();
        }
        loadRecentChats();
    }

    function setupResponsiveSidebar() {
        if (window.innerWidth >= 768) {
            // Desktop
            sidebar.classList.remove('collapsed');
            mainContent.classList.remove('expanded');
        } else {
            // Mobile
            sidebar.classList.add('collapsed');
            mainContent.classList.add('expanded');
        }
    }

    function toggleSidebar() {
        sidebar.classList.toggle('collapsed');
        mainContent.classList.toggle('expanded');
        
        setTimeout(() => {
            const messages = document.querySelectorAll('.chat-message');
            messages.forEach(msg => {
                msg.style.maxWidth = mainContent.classList.contains('expanded') 
                    ? '90%' 
                    : 'calc(100% - 40px)';
            });
        }, 300);
    }

    function showWelcomeMessage() {
        const messages = [
            "Welcome to the Public Transit Tracker! 🚌🚆",
            "I can help you with:",
            "- Real-time transit updates<br>- Route planning<br>- Schedule tracking",
            "How can I assist you with your transit needs today?"
        ];
    
        let delay = 1000;
        messages.forEach((msg, index) => {
            setTimeout(() => {
                addMessage(msg, 'bot-message');
                setTimeout(() => {
                    chatLog.scrollTop = chatLog.scrollHeight;
                }, 100);
            }, delay * index);
        });
    }

    function addMessage(content, type) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('chat-message', type);
        messageElement.innerHTML = content.replace(/\n/g, '<br>');
        
        messageElement.style.maxWidth = mainContent.classList.contains('expanded') 
            ? '90%' 
            : 'calc(100% - 40px)';
        
        chatLog.appendChild(messageElement);
        chatLog.scrollTop = chatLog.scrollHeight;

        // Store the last bot message for voice response
        if (type === 'bot-message') {
            lastBotMessage = content;
        }
        
        return messageElement;
    }

    function scrollChatToBottom() {
        chatLog.scrollTop = chatLog.scrollHeight;
    }

    function addBotMessage(message) {
        return addMessage(message, 'bot-message');
    }

    function addBotMessageWithTyping(message) {
        const messageElement = addBotMessage('Typing...');
        setTimeout(() => {
            if (messageElement && messageElement.parentNode) {
                messageElement.innerHTML = message.replace(/\n/g, '<br>');
                lastBotMessage = message;
                chatLog.scrollTop = chatLog.scrollHeight;
            }
        }, chatPacingDelay);
        return messageElement;
    }

    function handleGreeting() {
        const firstMessage = 'Hi 👋';
        const secondMessage = [
            'Ask me about routes, direct trains, fares, schedules, delays, platforms, bus vs train choices, metro connections, or passes.',
            '',
            'Example: plan a route from Delhi to Phagwara.'
        ].join('\n');

        addBotMessage(firstMessage);
        currentChat.push({ content: firstMessage, type: 'bot-message' });
        updateChatHistory();

        setTimeout(() => {
            addBotMessageWithTyping(secondMessage);
            currentChat.push({ content: secondMessage, type: 'bot-message' });
            updateChatHistory();
        }, 1200);
    }

    function isGreetingInput(input) {
        const normalized = (input || '').toLowerCase().trim();
        return normalized === 'hi' || normalized === 'hello' || normalized === 'hii';
    }

    function renderTimePreferenceButtons(options) {
        // Remove existing quick replies
        const existing = document.querySelector('.quick-replies');
        if (existing) existing.remove();

        const storedRoute = getStoredRouteContext();
        const routeText = storedRoute?.source && storedRoute?.destination
            ? ` from ${storedRoute.source} to ${storedRoute.destination}`
            : '';

        const container = document.createElement('div');
        container.className = 'quick-replies';
        container.style.display = 'flex';
        container.style.gap = '8px';
        container.style.margin = '8px 12px';

        options.forEach(opt => {
            const btn = document.createElement('button');
            btn.className = 'quick-reply-btn';
            btn.textContent = opt;
            btn.title = opt; // Edge/Accessibility: discernible text
            btn.setAttribute('aria-label', opt);
            btn.style.padding = '8px 12px';
            btn.style.borderRadius = '18px';
            btn.style.border = '1px solid rgba(0,0,0,0.1)';
            btn.style.background = '#fff';
            btn.style.cursor = 'pointer';
            btn.addEventListener('click', () => {
                userInput.value = `${opt}${routeText}`;
                // remove quick replies after selection
                container.remove();
                sendMessage();
            });
            container.appendChild(btn);
        });

        chatLog.appendChild(container);
        chatLog.scrollTop = chatLog.scrollHeight;
    }


    function addIRCTCButton() {
        // Avoid adding multiple IRCTC buttons in a row
        if (document.querySelector('.irctc-btn')) return null;

        const btn = document.createElement('button');
        btn.innerText = 'Book on IRCTC 🚆';
        btn.className = 'irctc-btn';
        btn.style.margin = '8px 12px';
        btn.onclick = () => {
            window.open('https://www.irctc.co.in', '_blank', 'noopener,noreferrer');
        };

        chatLog.appendChild(btn);
        scrollChatToBottom();
        return btn;
    }

    function formatDateForInput(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function formatTravelDate(dateValue) {
        if (!dateValue) {
            return '';
        }

        const selected = new Date(`${dateValue}T00:00:00`);
        if (Number.isNaN(selected.getTime())) {
            return dateValue;
        }

        return selected.toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        });
    }

    function showDatePicker() {
        const existingPicker = document.querySelector('.date-picker-message');
        if (existingPicker) {
            existingPicker.remove();
        }

        const div = document.createElement('div');
        div.className = 'chat-message bot-message date-picker-message';

        const today = new Date();
        const maxDate = new Date();
        maxDate.setDate(today.getDate() + 60);

        const min = formatDateForInput(today);
        const max = formatDateForInput(maxDate);

        div.innerHTML = `
            <p>📅 Select your travel date:</p>

            <input
                type="date"
                id="travelDate"
                class="date-input"
                min="${min}"
                max="${max}"
            >

            <button onclick="submitTravelDate()" class="date-btn">
                Confirm Date ✅
            </button>
        `;

        div.style.maxWidth = mainContent.classList.contains('expanded')
            ? '90%'
            : 'calc(100% - 40px)';

        chatLog.appendChild(div);
        scrollChatToBottom();
    }

    // Prevent native browser validation tooltip and provide custom messages
    // Attach handlers after the picker is inserted into DOM
    document.addEventListener('click', function attachDateHandlers(e) {
        const dateInput = document.getElementById('travelDate');
        if (!dateInput) return;

        // remove listener once attached
        document.removeEventListener('click', attachDateHandlers);

        dateInput.addEventListener('invalid', (ev) => {
            // prevent browser tooltip
            ev.preventDefault();
            const max = dateInput.max;
            try {
                const maxText = formatTravelDate(max);
                addBotMessage(`Please select a date on or before ${maxText}.`);
            } catch (err) {
                addBotMessage('Please select a valid travel date.');
            }
            // remove focus to avoid repeated native tooltip
            dateInput.blur();
        });

        dateInput.addEventListener('input', () => {
            // clear any custom validity to avoid native tooltip
            try { dateInput.setCustomValidity(''); } catch (e) {}
        });
    });

    function renderTrainResultsForSelectedDate(dateValue) {
        if (!lastRoute || !Array.isArray(lastTrains) || lastTrains.length === 0) {
            return;
        }

        const formattedDate = formatTravelDate(dateValue);
        const trainLines = lastTrains.map((train, index) => {
            return `${index + 1}) ${train}\n${getFoodInfo(train)}`;
        }).join('\n\n');

        const response = `Trains for ${formattedDate} travel (${lastRoute.source} → ${lastRoute.destination}):\n\n${trainLines}`;

        addBotMessage(response);
        currentChat.push({ content: response, type: 'bot-message' });
        updateChatHistory();
        setTimeout(() => {
            addIRCTCButton();
        }, 1000);
        saveChatToMongo();
    }

    window.submitTravelDate = function() {
        const dateInput = document.getElementById('travelDate');
        const date = dateInput ? dateInput.value : '';

        if (!date) {
            addBotMessage('Please select a travel date before confirming.');
            return;
        }

        // custom validation: ensure selected date <= max to avoid browser native tooltip
        if (dateInput && dateInput.max) {
            try {
                const selected = new Date(`${date}T00:00:00`);
                const maxDate = new Date(`${dateInput.max}T00:00:00`);
                if (selected > maxDate) {
                    addBotMessage(`Please select a date on or before ${formatTravelDate(dateInput.max)}.`);
                    return;
                }
            } catch (err) {
                // fallback: ignore and proceed
            }
        }

        localStorage.setItem(travelDateStorageKey, date);

        const formatted = formatTravelDate(date);
        const message = `📅 Travel Date Selected: ${formatted}`;

        addBotMessage(message);
        currentChat.push({ content: message, type: 'bot-message' });
        updateChatHistory();

        if (dateInput) {
            dateInput.disabled = true;
        }

        const confirmButton = document.querySelector('.date-picker-message .date-btn');
        if (confirmButton) {
            confirmButton.disabled = true;
            confirmButton.textContent = 'Date Confirmed';
        }

        (async () => {
            try {
                const response = await fetch(getChatEndpoint(), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: `travel date ${date}`, sessionId })
                });

                if (!response.ok) {
                    throw new Error('Server error');
                }

                const data = await response.json();
                const botMessage = document.createElement('div');
                botMessage.classList.add('chat-message', 'bot-message');
                botMessage.innerHTML = String(data.response || '').replace(/\n/g, '<br>');
                botMessage.style.maxWidth = mainContent.classList.contains('expanded')
                    ? '90%'
                    : 'calc(100% - 40px)';

                chatLog.appendChild(botMessage);
                chatLog.scrollTop = chatLog.scrollHeight;
                const picker = document.querySelector('.date-picker-message');
                if (picker) {
                    picker.remove();
                }
                if (/train options shown for the selected date/i.test(data.response || '')) {
                    setTimeout(() => {
                        renderTimePreferenceButtons(['Morning', 'Afternoon', 'Evening', 'Night']);
                    }, 250);
                }
                if (/^trains for /i.test(String(data.response || '').trim())) {
                    setTimeout(() => {
                        addIRCTCButton();
                    }, 1000);
                }
                currentChat.push({ content: data.response, type: 'bot-message' });
                updateChatHistory();
                saveChatToMongo();
            } catch (error) {
                console.error('Travel date flow failed:', error);
                addBotMessage('I could not load the train list for that date. Please try again.');
                saveChatToMongo();
            }
        })();
    };

    function addIRCTCBookingSection() {
        addBotMessage(`Need help booking or checking availability?\n\n🔗 Book tickets on IRCTC:\n<a href="https://www.irctc.co.in" target="_blank" rel="noopener noreferrer">https://www.irctc.co.in</a>`);
        showDatePicker();
        addIRCTCButton();
        saveChatToMongo();
    }

    async function sendMessage() {
        const message = userInput.value.trim();
        if (!message) return;

        storeRouteContextFromText(message);

        addMessage(message, 'user-message');
        currentChat.push({ content: message, type: 'user-message' });
        userInput.value = '';
        updateChatHistory();

        if (isGreetingInput(message)) {
            handleGreeting();
            return;
        }

        typingIndicator = addMessage('<div class="typing-indicator"><span></span><span></span><span></span></div>', 'bot-message');
        
        try {
            const response = await fetch(getChatEndpoint(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message, sessionId })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Server error');
            }

            const data = await response.json();
            
            if (typingIndicator && typingIndicator.parentNode) {
                chatLog.removeChild(typingIndicator);
            }

            // Delay bot response to slow chat pacing
            setTimeout(() => {
                const botMessage = addMessage(data.response, 'bot-message');
                // If response asks for a travel date, show the date picker
                if (/select your travel date|choose a travel date/i.test(data.response)) {
                    setTimeout(() => {
                        showDatePicker();
                    }, 400);
                }

                // Broader detection for train-result responses so IRCTC link appears reliably
                const respText = String(data.response || '').trim();
                const looksLikeTrainResult = /^trains for /i.test(respText)
                    || /available trains:/i.test(respText)
                    || /train options shown for the selected date/i.test(respText)
                    || /travel date:/i.test(respText)
                    || /\b\d{5}\b/.test(respText); // train number pattern

                if (looksLikeTrainResult) {
                    setTimeout(() => {
                        addIRCTCButton();
                    }, 1000);
                }

                currentChat.push({ content: data.response, type: 'bot-message' });
                updateChatHistory();
                saveChatToMongo();
            }, chatPacingDelay);

        } catch (error) {
            console.error("Chat error:", error);
            
            if (typingIndicator && typingIndicator.parentNode) {
                chatLog.removeChild(typingIndicator);
            }

            // Use new getBotResponse for fallback
            try {
                const botResponse = await getBotResponse(message);
                if (botResponse === null) {
                    updateChatHistory();
                    return;
                }
                // Delay fallback bot response to respect pacing
                setTimeout(() => {
                    const botEl = addMessage(botResponse, 'bot-message');
                    if (/select your travel date|choose a travel date/i.test(botResponse)) {
                        setTimeout(() => {
                            showDatePicker();
                        }, 400);
                    }
                    if (/^trains for /i.test(String(botResponse || '').trim())) {
                        setTimeout(() => {
                            addIRCTCButton();
                        }, 1000);
                    }
                    currentChat.push({ content: botResponse, type: 'bot-message' });
                    updateChatHistory();
                    saveChatToMongo();
                }, chatPacingDelay);
            } catch (err) {
                addMessage("Unable to process request. Try: Delhi to Mumbai", 'bot-message');
                currentChat.push({ content: "Unable to process request. Try: Delhi to Mumbai", type: 'bot-message' });
                updateChatHistory();
                saveChatToMongo();
            }
        } finally {
            typingIndicator = null;
        }
    }

    function updateChatHistory() {
        if (currentChat.length === 0) return;
        
        localStorage.setItem(`chat-${sessionId}`, JSON.stringify(currentChat));
        
        const existingIndex = chatHistory.findIndex(chat => chat.id === sessionId);
        const lastMessage = currentChat[currentChat.length - 1].content;
        
        const chatEntry = {
            id: sessionId,
            lastMessage: lastMessage.length > 50 
                ? lastMessage.substring(0, 50) + '...' 
                : lastMessage,
            timestamp: new Date().toLocaleTimeString()
        };

        if (existingIndex >= 0) {
            chatHistory[existingIndex] = chatEntry;
        } else {
            chatHistory.unshift(chatEntry);
            if (chatHistory.length > 10) chatHistory.pop();
        }
        
        localStorage.setItem('chatHistory', JSON.stringify(chatHistory));
        loadRecentChats();
        saveChatToMongo();
    }

    function loadRecentChats() {
        recentChats.innerHTML = '';
        
        if (chatHistory.length === 0) {
            recentChats.innerHTML = '<div class="no-chats">No recent conversations</div>';
            return;
        }

        const clearBtn = document.createElement('button');
        clearBtn.className = 'clear-btn';
        clearBtn.textContent = 'Clear History';
        clearBtn.addEventListener('click', clearAllChats);
        recentChats.appendChild(clearBtn);

        chatHistory.forEach(chat => {
            const chatItem = document.createElement('div');
            chatItem.className = 'chat-item';
            chatItem.innerHTML = `
                <div class="chat-preview">${chat.lastMessage}</div>
                <div class="chat-time">${chat.timestamp}</div>
                <button class="delete-btn">×</button>
            `;
            
            chatItem.querySelector('.delete-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                deleteChat(chat.id);
            });
            
            chatItem.addEventListener('click', () => {
                loadChat(chat.id);
                if (window.innerWidth <= 768) {
                    sidebar.classList.add('collapsed');
                }
            });
            recentChats.appendChild(chatItem);
        });
    }

    function loadChat(chatId) {
        const chatData = JSON.parse(localStorage.getItem(`chat-${chatId}`)) || [];
        sessionId = chatId;
        currentChat = chatData;
        localStorage.setItem('sessionId', sessionId);
        initializeChat();
    }

    function deleteChat(chatId) {
        localStorage.removeItem(`chat-${chatId}`);
        chatHistory = chatHistory.filter(chat => chat.id !== chatId);
        localStorage.setItem('chatHistory', JSON.stringify(chatHistory));
        
        if (chatId === sessionId) startNewChat();
        loadRecentChats();
    }

    function clearAllChats() {
        chatHistory.forEach(chat => {
            localStorage.removeItem(`chat-${chat.id}`);
        });
        
        chatHistory = [];
        currentChat = [];
        sessionId = generateSessionId();
        
        localStorage.setItem('chatHistory', JSON.stringify(chatHistory));
        localStorage.setItem('sessionId', sessionId);
        
        loadRecentChats();
        initializeChat();
    }

    function startNewChat() {
        if (currentChat.length > 0) {
            updateChatHistory();
        }
    
        sessionId = generateSessionId();
        currentChat = [];
        
        localStorage.setItem(`chat-${sessionId}`, JSON.stringify(currentChat));
        localStorage.setItem('sessionId', sessionId);
        
        chatLog.innerHTML = '';
        showWelcomeMessage();
        
        loadRecentChats();
    }

    // Event listeners
    sendButton.addEventListener('click', sendMessage);
    userInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    newChatBtn.addEventListener('click', startNewChat);
    sidebarToggle.addEventListener('click', toggleSidebar);
    sidebarToggle.addEventListener('touchstart', toggleSidebar);
    
    // Voice input button
    voiceButton.addEventListener('click', () => {
        if (recognition) {
            recognition.start();
        }
    });
    
    // Speak response button
    speakResponseButton.addEventListener('click', () => {
        if (window.speechSynthesis.speaking) {
            window.speechSynthesis.cancel();
            stopSpeechButton.style.display = 'none';
            speakResponseButton.style.display = 'flex';
            stopSpeechButton.classList.remove('active');
        } else if (lastBotMessage) {
            speakText(lastBotMessage);
        } else {
            addMessage("No response available to speak", 'bot-error');
        }
    });

    // Check for speech synthesis support
    if (!('speechSynthesis' in window)) {
        speakResponseButton.disabled = true;
        speakResponseButton.title = "Text-to-speech not supported in your browser";
    }

    userInput.focus();

    // Responsive behavior
    window.addEventListener('resize', () => {
        if (window.innerWidth >= 768) {
            sidebar.classList.remove('collapsed');
            mainContent.classList.remove('expanded');
        } else {
            sidebar.classList.add('collapsed');
            mainContent.classList.add('expanded');
        }
        
        const messages = document.querySelectorAll('.chat-message');
        messages.forEach(msg => {
            msg.style.maxWidth = mainContent.classList.contains('expanded') 
                ? '90%' 
                : 'calc(100% - 40px)';
        });
    });

    document.addEventListener('click', (e) => {
        if (window.innerWidth < 768 && 
            !sidebar.contains(e.target) && 
            e.target !== sidebarToggle && 
            !sidebarToggle.contains(e.target) &&
            !sidebar.classList.contains('collapsed')) {
            toggleSidebar();
        }
    });
});

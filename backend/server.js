const express = require('express');
const path = require('path');
const cors = require('cors');
const { GoogleGenerativeAI } = require("@google/generative-ai");

require('dotenv').config({ path: path.join(__dirname, '.env') });

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const app = express();
const port = process.env.PORT || 3000;

// Connect to MongoDB (optional - will use local fallback if MONGO_URI not set)
try {
    const connectDB = require('./db');
    connectDB(process.env.MONGO_URI).catch(err => console.warn('Mongo connect failed:', err.message));
} catch (e) {
    console.warn('No DB module found or failed to start DB connection', e.message);
}
const geminiModelName = process.env.GEMINI_MODEL || "gemini-2.0-flash";
const distanceMatrixApiKey = process.env.DISTANCE_MATRIX_API_KEY;
const rapidApiKey = process.env.RAPIDAPI_KEY;
const rapidApiRailHost = process.env.RAPIDAPI_RAIL_HOST || "indian-railway-api.p.rapidapi.com";
const routeContextBySession = new Map();
const geocodeCache = new Map();
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

const transitTraining = [
    {
        intent: "greeting",
        keywords: ["hi", "hello", "hey", "start", "help"],
        response: () => [
            "hii",
            "Ask me about routes, direct trains, fares, schedules, delays, platforms, bus vs train choices, metro connections, or passes.",
            "Example: plan a route from Delhi to Phagwara."
        ].join("\n")
    },
    {
        intent: "fare",
        keywords: ["fare", "price", "cost", "ticket", "charge", "rs", "rupee"],
        response: (route, details) => {
            const routeName = route?.source && route?.destination
                ? `${route.source} to ${route.destination}`
                : "your route";
            const distance = route?.source && route?.destination ? distances[getRouteKey(route.source, route.destination)] : 0;
            if (distance) {
                const fare = estimateFare(distance);
                return [
                    `Fare estimate for ${routeName}:`,
                    `Distance: ${distance} km.`,
                    `- Sleeper: Rs ${fare.sleeper}`,
                    `- AC: Rs ${fare.ac}`,
                    "Final fare can change by train type, quota, reservation charges, and availability, so verify on IRCTC before booking."
                ].join("\n");
            }
            const price = details.price ? `You mentioned Rs ${details.price}; use that as your current estimate.` : "For a demo estimate, local bus trips are usually cheapest, metro is mid-range, and intercity trains vary by class.";

            return [
                `Fare guidance for ${routeName}:`,
                price,
                "1) Check the official app or station counter for the final fare.",
                "2) Compare regular, express, AC, sleeper, and reserved options.",
                "3) Keep a small buffer for reservation fees, platform tickets, or last-mile transport."
            ].join("\n");
        }
    },
    {
        intent: "delay",
        keywords: ["delay", "late", "cancel", "cancelled", "canceled", "traffic", "service alert", "disruption"],
        response: (route) => {
            const routeName = route?.source && route?.destination
                ? `${route.source} to ${route.destination}`
                : "your service";

            return [
                `Delay plan for ${routeName}:`,
                "1) Check the official service status page, NTES, or the station display.",
                "2) If the delay is over 20 minutes, compare the next train, bus, or metro connection.",
                "3) For important trips, leave one earlier service as a backup.",
                "4) Recheck platform and arrival status close to departure."
            ].join("\n");
        }
    },
    {
        intent: "platform",
        keywords: ["platform", "running", "status", "live", "track", "train number"],
        response: (route) => {
            const routeName = route?.source && route?.destination
                ? `${route.source} to ${route.destination}`
                : "your train";

            return [
                `Live status checklist for ${routeName}:`,
                "1) Search by train number in NTES or the official railway app.",
                "2) Confirm platform after the train is close to the station.",
                "3) Check expected arrival, departure, and current running delay.",
                "4) Keep alerts on until boarding because platforms can change."
            ].join("\n");
        }
    },
    {
        intent: "direct",
        keywords: ["direct", "zero change", "zero-change", "without change", "non stop", "nonstop"],
        response: (route) => {
            const routeName = route?.source && route?.destination
                ? `${route.source} to ${route.destination}`
                : "your source and destination";

            return [
                `Direct route check for ${routeName}:`,
                "1) Search the exact stations or stops first.",
                "2) Apply direct, zero-change, or no-transfer filters.",
                "3) Compare departure time, arrival time, total duration, and seat availability.",
                "4) If no direct option is available, choose one transfer at a major junction."
            ].join("\n");
        }
    },
    {
        intent: "bus_train_compare",
        keywords: ["bus vs train", "train vs bus", "compare bus", "compare train", "best mode", "which is better"],
        response: (route) => {
            const routeName = route?.source && route?.destination
                ? `${route.source} to ${route.destination}`
                : "this trip";

            return [
                `Bus vs train comparison for ${routeName}:`,
                "- Train: better for longer distance, predictable arrival, and reserved seats.",
                "- Bus: better for flexible pickup points, late-night options, and places without nearby railway stations.",
                "- Metro/local transit: best for city travel and last-mile connections.",
                "Choose the mode with the best total door-to-door time, not just the lowest fare."
            ].join("\n");
        }
    },
    {
        intent: "metro",
        keywords: ["metro", "subway", "local train", "last mile", "connection"],
        response: (route) => {
            const routeName = route?.source && route?.destination
                ? `${route.source} to ${route.destination}`
                : "your route";

            return [
                `Metro and last-mile plan for ${routeName}:`,
                "1) Use metro or local train for the city segment if stations are nearby.",
                "2) Keep 10 to 15 minutes for walking, security, and platform changes.",
                "3) Use bus, auto, or cab only for the final stretch if direct transit is not available.",
                "4) Avoid very tight transfers during peak hours."
            ].join("\n");
        }
    },
    {
        intent: "pass",
        keywords: ["pass", "monthly", "weekly", "student", "discount", "concession"],
        response: () => [
            "Pass guidance:",
            "1) Choose a daily pass only if you will take multiple rides in one day.",
            "2) Choose a weekly or monthly pass for repeated commuting.",
            "3) Students and senior passengers should check concession rules before booking.",
            "4) Compare pass cost with your expected number of trips."
        ].join("\n")
    }
];

function includesAny(text, keywords) {
    return keywords.some(keyword => {
        if (keyword.includes(" ") || keyword.includes("-")) {
            return text.includes(keyword);
        }

        const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`(^|\\W)${escapedKeyword}(\\W|$)`, "i").test(text);
    });
}

function randomChoice(items) {
    return items[Math.floor(Math.random() * items.length)];
}

function detectIntent(text) {
    const normalized = (text || "").toLowerCase();

    if (normalized.includes("direct") || normalized.includes("non stop") || normalized.includes("non-stop") || normalized.includes("zero change") || normalized.includes("zero-change")) {
        return "direct_train";
    }

    if (normalized.includes("time") || normalized.includes("schedule") || normalized.includes("arrival") || normalized.includes("departure")) {
        return "train_time";
    }

    if (normalized.includes("ticket") || normalized.includes("book") || normalized.includes("booking")) {
        return "booking";
    }

    if (normalized.includes("route") || normalized.includes("plan") || normalized.includes("from") || normalized.includes("to")) {
        return "route_help";
    }

    return "fallback";
}

function isGreeting(text) {
    return /^(hi+|hello+|hey+|namaste|help)\b/i.test(text.trim());
}

function normalizePlace(text) {
    return text
        .replace(/\b(my|the|is|at|to|from|and|destination|start|source)\b/gi, "")
        .replace(/\b(with|by|using|via|for|including|fare|price|cost|timing|time|schedule|train|bus|metro)\b.*$/gi, "")
        .replace(/[^a-zA-Z\s]/g, "")
        .trim();
}

function extractRoutePlaces(message) {
    const text = (message || "")
        .replace(/^\s*(show|give|find|check|plan)\s+(me\s+)?(a\s+)?(route|plan|trip|journey)\s+(from\s+)?/i, "from ")
        .replace(/^\s*(route|plan|trip|travel|journey)\s+(from\s+)?/i, "from ");

    // Pattern: from X to Y
    const fromToMatch = text.match(/\bfrom\s+([a-zA-Z\s]+?)\s+to\s+([a-zA-Z\s]+)/i);
    if (fromToMatch) {
        return {
            source: normalizePlace(fromToMatch[1]),
            destination: normalizePlace(fromToMatch[2])
        };
    }

    // Pattern: start is X and destination is Y
    const startDestMatch = text.match(/start\s+is\s+([a-zA-Z\s]+?)\s+and\s+destination\s+is\s+([a-zA-Z\s]+)/i);
    if (startDestMatch) {
        return {
            source: normalizePlace(startDestMatch[1]),
            destination: normalizePlace(startDestMatch[2])
        };
    }

    // Pattern: X to Y
    const simpleToMatch = text.match(/^\s*([a-zA-Z][a-zA-Z\s]{1,60}?)\s+to\s+([a-zA-Z][a-zA-Z\s]{1,60})\s*$/i);
    if (simpleToMatch) {
        return {
            source: normalizePlace(simpleToMatch[1]),
            destination: normalizePlace(simpleToMatch[2])
        };
    }

    return { source: "", destination: "" };
}

const stateStationOptions = {
    kerala: ["Kochi", "Trivandrum", "Ernakulam"],
    punjab: ["Ludhiana", "Jalandhar", "Amritsar", "Phagwara"],
    "tamil nadu": ["Chennai", "Coimbatore", "Madurai"],
    karnataka: ["Bangalore", "Mysore", "Mangalore"],
    "andhra pradesh": ["Hyderabad", "Vijayawada", "Visakhapatnam"]
};

const knownStations = [
    "delhi",
    "mumbai",
    "hyderabad",
    "bangalore",
    "chennai",
    "kochi",
    "trivandrum",
    "ernakulam",
    "phagwara",
    "ludhiana",
    "jalandhar",
    "amritsar",
    "coimbatore",
    "madurai",
    "mysore",
    "mangalore",
    "vijayawada",
    "visakhapatnam",
    "nagpur",
    "pune",
    "jaipur",
    "bhopal",
    "kolkata",
    "lucknow",
    "nallagandla",
    "lingampalli",
    "lingampally"
];

const specialRouteAliases = {
    nallagandla: "nallagandla",
    "nalla gandla": "nallagandla",
    lingampalli: "nallagandla",
    lingampally: "nallagandla"
};

// ==========================
// 1. EXTRACT SOURCE & DESTINATION
// ==========================
function extractStations(input) {
    input = input.toLowerCase();

    let match = input.match(/from\s+(.+?)\s+to\s+(.+)/) || input.match(/(.+?)\s+to\s+(.+)/);

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
    "andhra pradesh": ["hyderabad", "vijayawada", "visakhapatnam"],
    "karnataka": ["bangalore", "mysore"],
    "tamil nadu": ["chennai", "madurai"],
    "punjab": ["ludhiana", "jalandhar", "amritsar", "phagwara"]
};

// ==========================
// 3. STATION CODES
// ==========================
const stationCodes = {
    "delhi": "NDLS",
    "new delhi": "NDLS",
    "nagpur": "NGP",
    "bangalore": "SBC",
    "bengaluru": "SBC",
    "hyderabad": "HYB",
    "mumbai": "CSMT",
    "chennai": "MAS",
    "pune": "PUNE",
    "jaipur": "JP",
    "bhopal": "BPL",
    "kolkata": "HWH",
    "lucknow": "LKO",
    "kochi": "ERS",
    "ernakulam": "ERS",
    "trivandrum": "TVC",
    "phagwara": "PGW",
    "ludhiana": "LDH",
    "jalandhar": "QSH",
    "amritsar": "ASR",
    "coimbatore": "CBE",
    "madurai": "MDU",
    "mysore": "MYS",
    "mangalore": "MAQ",
    "vijayawada": "BZA",
    "visakhapatnam": "VSKP",
    "nallagandla": "LPI",
    "lingampalli": "LPI",
    "lingampally": "LPI"
};

function getCode(city) {
    return stationCodes[city.toLowerCase()] || "";
}

// ==========================
// 4. DISTANCE ESTIMATION (fallback)
// ==========================
function estimateDistance(src, dest) {
    const map = {
        "delhi-bangalore": 2150,
        "delhi-nagpur": 980,
        "delhi-hyderabad": 1550,
        "delhi-mumbai": 1400,
        "delhi-chennai": 2200,
        "delhi-pune": 1500,
        "delhi-jaipur": 280,
        "bangalore-hyderabad": 570,
        "bangalore-mumbai": 980,
        "mumbai-hyderabad": 750,
        "mumbai-pune": 150,
        "hyderabad-mumbai": 750,
        "phagwara-nallagandla": 1850,
        "nallagandla-phagwara": 1850,
        "phagwara-lingampalli": 1850,
        "lingampalli-phagwara": 1850,
        "chennai-hyderabad": 630,
        "chennai-bangalore": 350,
        "delhi-kolkata": 1500,
        "delhi-lucknow": 500
    };

    let key = `${src.toLowerCase()}-${dest.toLowerCase()}`;
    let reverse = `${dest.toLowerCase()}-${src.toLowerCase()}`;

    // Return known distance or estimate with fallback
    if (map[key]) return map[key];
    if (map[reverse]) return map[reverse];
    
    return 1200;
}

// Check if input is a state name and return its cities
function checkState(destination) {
    return stateStationOptions[destination.toLowerCase()];
}

// Generate route response dynamically for ANY route
function generateRoute(src, dest, distance) {
    let trains = getTrainSuggestion(distance);
    
    return `Route plan: ${src} → ${dest}

Distance: ~${distance} km
Estimated duration: depends on train (~10–40 hrs)

Direct train options:
${trains.map((t, i) => `${i+1}) ${t}`).join("\n")}

Fare estimate:
- Sleeper: ₹500–₹900
- AC: ₹1500–₹3000

Suggestions:
1) Check IRCTC for exact trains
2) Compare timings and fares
3) Confirm platform on NTES`;
}

// Get train suggestions based on distance
function getTrainSuggestion(distance) {
    if (!distance || distance === 0) {
        return ["Intercity Express", "Passenger Train"];
    }
    if (distance < 800) {
        return ["Intercity Express", "Superfast Express", "Passenger Train"];
    }
    if (distance < 1500) {
        return ["Superfast Express", "Rajdhani Express", "Mail Express"];
    }
    return ["Rajdhani Express", "Long Distance Express", "Suvidha Express"];
}

function findKnownItem(text, items) {
    const normalized = (text || "").toLowerCase();
    return items.find(item => new RegExp(`(^|\\W)${item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\W|$)`, "i").test(normalized)) || "";
}

function buildStateClarificationResponse(route, message) {
    const stateNames = Object.keys(stateStationOptions);
    const routeDestinationState = route.destination ? stateNames.find(state => route.destination.toLowerCase() === state) : "";
    const routeSourceState = route.source ? stateNames.find(state => route.source.toLowerCase() === state) : "";
    const mentionedState = routeDestinationState || routeSourceState || findKnownItem(message, stateNames);

    if (!mentionedState) {
        return "";
    }

    const exactStationMentioned = findKnownItem(message, knownStations);
    const routeHasStateAsPlace = routeDestinationState || routeSourceState;
    if (!routeHasStateAsPlace && exactStationMentioned) {
        return "";
    }

    const options = stateStationOptions[mentionedState].join(", ");
    return `${toTitleCase(mentionedState)} has multiple stations (${options}). Please specify the exact source and destination station, for example: Delhi to Kochi.`;
}

function toTitleCase(text) {
    return (text || "").replace(/\b\w/g, char => char.toUpperCase());
}

function extractTravelDetails(message) {
    const text = (message || "").toLowerCase();
    const startMatch = text.match(/start\s*(?:is\s*)?(\d{1,2})(?:\s*)(am|pm)/i);
    const endMatch = text.match(/(?:end(?:\s+journey\s*time)?|arrival(?:\s+time)?)\s*(?:is\s*)?(\d{1,2})(?:\s*)(am|pm)/i);
    const durationMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:hrs?|hours?)/i);
    const priceMatch = text.match(/(?:price|fare|cost|ticket(?:\s+price)?)\s*(?:is|around|about)?\s*₹?\s*(\d+(?:\.\d+)?)/i) || text.match(/₹\s*(\d+(?:\.\d+)?)/i) || text.match(/\b(\d+(?:\.\d+)?)\s*rs\b/i);

    return {
        start: startMatch ? `${startMatch[1]}${startMatch[2].toLowerCase()}` : "",
        end: endMatch ? `${endMatch[1]}${endMatch[2].toLowerCase()}` : "",
        duration: durationMatch ? durationMatch[1] : "",
        price: priceMatch ? priceMatch[1] : ""
    };
}

function generateFallbackTransitResponse(message) {
    const text = (message || "").toLowerCase();
    const { source, destination } = extractRoutePlaces(message);
    const intent = detectIntent(message);

    if (text.includes("direct train") || text.includes("check direct train first")) {
        return randomChoice(localResponses.direct_train);
    }

    if (text.includes("morning") || text.includes("afternoon") || text.includes("night")) {
        return "Sample schedule strategy: Morning option has best same-day arrival, afternoon balances convenience, and night trains are often cheaper with sleeper availability. Choose based on arrival priority and seat class availability.";
    }

    if (intent === "direct_train") {
        return randomChoice(localResponses.direct_train);
    }

    if (intent === "train_time") {
        return randomChoice(localResponses.train_time);
    }

    if (intent === "booking") {
        return randomChoice(localResponses.booking);
    }

    if (source && destination) {
        return [
            `Fallback route guidance for ${source} to ${destination}:`,
            "1) Check direct trains first (fastest for intercity routes).",
            "2) If no direct option, find nearest major junctions and plan one transfer.",
            "3) Compare train vs bus by total duration and arrival time.",
            "4) Confirm live platform/timing in official apps before travel.",
            `If you want, I can also give a sample travel plan with morning, afternoon, and night options for ${source} to ${destination}.`
        ].join("\n");
    }

    if (text.includes("route") || text.includes("from") || text.includes("to")) {
        return randomChoice(localResponses.route_help);
    }

    if (text.includes("fare") || text.includes("price") || text.includes("ticket")) {
        return "Live fare lookup is temporarily unavailable. Please check your city transit app or station counter for exact pricing. If you share your city and trip type, I can help estimate common fare ranges.";
    }

    if (text.includes("delay") || text.includes("late") || text.includes("cancel")) {
        return "I cannot pull real-time delay feeds at the moment. Check the official transit status page or station alerts. If you share your route number, I can help with alternate planning steps.";
    }

    return randomChoice(localResponses.fallback);
}

function buildTrainedTransitResponse(text, route, travelDetails) {
    if (isGreeting(text)) {
        return transitTraining[0].response(route, travelDetails);
    }

    const matchedTraining = transitTraining.find(item => includesAny(text, item.keywords));
    if (matchedTraining) {
        return matchedTraining.response(route, travelDetails);
    }

    return "";
}

function getRouteKey(from, to) {
    if (!from || !to) return "";
    const normalize = place => {
        const clean = String(place).toLowerCase().trim();
        return specialRouteAliases[clean] || clean;
    };
    return `${normalize(from)}-${normalize(to)}`;
}

function getDistance(src, dest) {
    const key = getRouteKey(src, dest);
    const [from, to] = key.split("-");
    const reverse = `${to}-${from}`;
    return distances[key] || distances[reverse] || 1200;
}

function estimateFare(distance) {
    return {
        sleeper: Math.round(distance * 0.5),
        ac: Math.round(distance * 1.2)
    };
}

function estimateFareRange(distance) {
    if (!distance) {
        return {
            sleeper: "Rs 500-Rs 800",
            ac: "Rs 1500-Rs 3000"
        };
    }

    const sleeperBase = Math.round(distance * 0.65);
    const acBase = Math.round(distance * 2.5);
    const roundToHundred = value => Math.round(value / 100) * 100;

    return {
        sleeper: `Rs ${roundToHundred(sleeperBase * 0.8)}-Rs ${roundToHundred(sleeperBase * 1.4)}`,
        ac: `Rs ${roundToHundred(acBase * 0.65)}-Rs ${roundToHundred(acBase * 1.4)}`
    };
}

function buildPhagwaraNallagandlaPlan(route) {
    const key = getRouteKey(route.source, route.destination);
    if (key !== "phagwara-nallagandla" && key !== "nallagandla-phagwara") {
        return "";
    }

    const reverse = key === "nallagandla-phagwara";
    const source = reverse ? "Nallagandla" : "Phagwara";
    const destination = reverse ? "Phagwara" : "Nallagandla";
    const distance = distances[key] || 1850;
    const fare = estimateFareRange(distance);
    const mainLeg = reverse
        ? "Use Lingampalli (LPI), Hyderabad (HYB), or Secunderabad (SC) as the boarding station, then travel north toward Delhi/Jalandhar/Phagwara."
        : "Search Phagwara (PGW) to Lingampalli (LPI), Hyderabad (HYB), or Secunderabad (SC). Nallagandla is a Hyderabad locality, so Lingampalli is the closest practical rail target.";
    const altLeg = reverse
        ? "If a direct south-to-Phagwara train is not available, take Hyderabad/Secunderabad to New Delhi, then New Delhi to Phagwara."
        : "If a direct PGW to Hyderabad/LPI train is not available, take Phagwara to New Delhi first, then New Delhi to Hyderabad/Secunderabad, and finish by MMTS/cab to Lingampalli/Nallagandla.";

    return [
        `Route plan: ${source} to ${destination}`,
        "",
        `Distance: ~${distance} km | Duration: ${calculateTravelTime(distance)}`,
        `Fare estimate: Sleeper ${fare.sleeper}, AC ${fare.ac}`,
        "",
        "Direct train check:",
        "No reliable direct train should be assumed for Phagwara to Nallagandla because Nallagandla is not the long-distance railway endpoint.",
        mainLeg,
        "",
        "Best train alternative:",
        `1) ${altLeg}`,
        "2) Check these station pairs on IRCTC/NTES: PGW to LPI, PGW to HYB, PGW to SC, and PGW to NDLS plus NDLS to HYB/SC.",
        "3) After reaching Lingampalli or Hyderabad/Secunderabad, take MMTS, metro plus auto, or cab to Nallagandla.",
        "",
        "Suggested trains to compare:",
        "- Phagwara to New Delhi: Shatabdi/Jhelum/Sachkhand type options depending on date.",
        "- New Delhi to Hyderabad/Secunderabad: Telangana Express or Dakshin Express type options.",
        "",
        "Always verify live train availability, running status, and platform on IRCTC or NTES before booking."
    ].join("\n");
}

function formatDistanceRange(distance) {
    if (!distance) {
        return "varies by route";
    }

    const lower = Math.floor(distance / 50) * 50;
    const upper = Math.ceil(distance / 50) * 50;
    return lower === upper ? `~${distance} km` : `~${lower}-${upper} km`;
}

function getDirectTrains(route) {
    return trainData?.[getRouteKey(route.source, route.destination)] || [];
}

const stationCodeMap = {
    delhi: "NDLS",
    "new delhi": "NDLS",
    bhopal: "BPL",
    mumbai: "CSMT",
    nagpur: "NGP",
    pune: "PUNE",
    hyderabad: "HYB",
    secunderabad: "SC",
    lingampalli: "LPI",
    lingampally: "LPI",
    nallagandla: "LPI",
    bangalore: "SBC",
    bengaluru: "SBC",
    chennai: "MAS",
    jaipur: "JP",
    kochi: "ERS",
    ernakulam: "ERS",
    trivandrum: "TVC",
    phagwara: "PGW"
};

function getStationCode(city) {
    return stationCodeMap[(city || "").toLowerCase().trim()] || "";
}

function parseDistanceKm(distanceText) {
    if (!distanceText) return 0;
    const number = String(distanceText).replace(/,/g, "").match(/\d+(?:\.\d+)?/);
    return number ? Math.round(Number(number[0])) : 0;
}

async function getLiveDistance(source, destination) {
    if (!distanceMatrixApiKey) {
        return null;
    }

    try {
        const params = new URLSearchParams({
            origins: source,
            destinations: destination,
            key: distanceMatrixApiKey
        });
        const response = await fetch(`https://api.distancematrix.ai/maps/api/distancematrix/json?${params.toString()}`);
        if (!response.ok) {
            return null;
        }

        const data = await response.json();
        const element = data?.rows?.[0]?.elements?.[0];
        const text = element?.distance?.text;
        if (!text) {
            return null;
        }

        return {
            text,
            km: parseDistanceKm(text)
        };
    } catch (error) {
        console.error("Distance API Error:", error.message);
        return null;
    }
}

async function geocodePlace(place) {
    const cacheKey = (place || "").toLowerCase().trim();
    if (!cacheKey) {
        return null;
    }

    if (geocodeCache.has(cacheKey)) {
        return geocodeCache.get(cacheKey);
    }

    try {
        const params = new URLSearchParams({
            q: `${place}, India`,
            format: "json",
            limit: "1"
        });
        const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
            headers: {
                "User-Agent": "TransitTrackerStudentProject/1.0"
            }
        });
        if (!response.ok) {
            return null;
        }

        const data = await response.json();
        const first = data?.[0];
        if (!first?.lat || !first?.lon) {
            return null;
        }

        const result = {
            lat: Number(first.lat),
            lon: Number(first.lon)
        };
        geocodeCache.set(cacheKey, result);
        return result;
    } catch (error) {
        console.error("Geocoding Error:", error.message);
        return null;
    }
}

function calculateHaversineKm(from, to) {
    const toRadians = degrees => degrees * Math.PI / 180;
    const earthRadiusKm = 6371;
    const dLat = toRadians(to.lat - from.lat);
    const dLon = toRadians(to.lon - from.lon);
    const lat1 = toRadians(from.lat);
    const lat2 = toRadians(to.lat);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(earthRadiusKm * c * 1.15);
}

async function getApproxDistance(source, destination) {
    const from = await geocodePlace(source);
    const to = await geocodePlace(destination);
    if (!from || !to) {
        return null;
    }

    const km = calculateHaversineKm(from, to);
    return {
        text: `~${km} km`,
        km
    };
}

async function getLiveTrains(source, destination) {
    if (!rapidApiKey) {
        return [];
    }

    const sourceCode = getStationCode(source);
    const destinationCode = getStationCode(destination);
    if (!sourceCode || !destinationCode) {
        return [];
    }

    try {
        const params = new URLSearchParams({ from: sourceCode, to: destinationCode });
        const response = await fetch(`https://${rapidApiRailHost}/trains?${params.toString()}`, {
            headers: {
                "X-RapidAPI-Key": rapidApiKey,
                "X-RapidAPI-Host": rapidApiRailHost
            }
        });
        if (!response.ok) {
            return [];
        }

        const data = await response.json();
        const trains = data?.trains || data?.data?.trains || data?.data || [];
        if (!Array.isArray(trains)) {
            return [];
        }

        return trains
            .map(train => train.name || train.train_name || train.trainName || train.number || train.train_number)
            .filter(Boolean)
            .slice(0, 3);
    } catch (error) {
        console.error("Train API Error:", error.message);
        return [];
    }
}

// Smart train fallback - guess expected trains based on distance
function guessTrains(distance) {
    if (!distance || distance === 0) {
        return ["Intercity Express", "Passenger Train"];
    }
    if (distance < 800) {
        return ["Intercity Express", "Superfast Express", "Passenger Train"];
    }
    if (distance < 1500) {
        return ["Superfast Express", "Rajdhani Express", "Mail Express"];
    }
    return ["Rajdhani Express", "Long-distance Express", "Suvidha Express"];
}

function generateRouteTips(distance, hasDirectTrain, trainList = []) {
    const tips = [];

    if (hasDirectTrain) {
        tips.push("Prefer Shatabdi, Rajdhani, or superfast trains for speed.");
    } else {
        // Smart fallback - show expected trains instead of saying no data
        const expectedTrains = guessTrains(distance);
        tips.push(`Direct trains are likely available. Check IRCTC/NTES for live availability.`);
        tips.push(`Expected trains: ${expectedTrains.join(", ")}`);
    }

    tips.push("Check seat availability on IRCTC before booking.");
    tips.push("Confirm platform and live running status on NTES before travel.");

    return tips;
}

// Smart time suggestion based on distance
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

// Time preference menu with emojis
function getTimePreferenceMenu() {
    return `\n\n🕒 When do you prefer to travel?\n\n🌅 Morning (5AM–12PM) → Better views, productive  \n☀️ Afternoon (12PM–5PM) → Less preferred (heat)  \n🌇 Evening (5PM–9PM) → Balanced option  \n🌙 Night (9PM–5AM) → More comfortable (sleep)\n\n👉 Choose: Morning / Afternoon / Evening / Night`;
}

function extractTravelDate(message) {
    const text = String(message || "");
    const isoMatch = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    return isoMatch ? isoMatch[1] : "";
}

// Try to parse start hour from train string like "(11:00 →" or "11:00 →"
function parseTrainStartHour(trainStr) {
    if (!trainStr || typeof trainStr !== 'string') return null;
    const m = trainStr.match(/(\d{1,2}):(\d{2})/);
    if (!m) return null;
    const hour = Number(m[1]);
    return hour;
}

function randomTimeByHour(startHour) {
    const hour = (startHour + Math.floor(Math.random() * 3)) % 24;
    const minute = Math.floor(Math.random() * 60);
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function generateTime(durationHours, index = 0) {
    const startHours = [6, 14, 21];
    const startHour = startHours[index % startHours.length];
    const endHour = (startHour + durationHours) % 24;
    const dayOffset = Math.floor((startHour + durationHours) / 24);

    return {
        departure: `${String(startHour).padStart(2, "0")}:00`,
        arrival: `${String(endHour).padStart(2, "0")}:00${dayOffset ? `+${dayOffset}` : ""}`
    };
}

function generateSyntheticTrainNumber(source, destination, index = 0, hint = "", attempt = 0) {
    const seedInput = `${String(source || "").toLowerCase()}|${String(destination || "").toLowerCase()}|${String(hint || "").toLowerCase()}|${index}|${attempt}`;
    let hash = 0;

    for (let i = 0; i < seedInput.length; i += 1) {
        hash = ((hash << 5) - hash) + seedInput.charCodeAt(i);
        hash |= 0;
    }

    const positiveHash = Math.abs(hash);
    return 10000 + (positiveHash % 90000);
}

function ensureUniqueTrainNumbers(trains, source, destination) {
    const usedNumbers = new Set();

    return (Array.isArray(trains) ? trains : []).map((train, index) => {
        let trainNumber = Number(train?.train_number);

        if (!Number.isFinite(trainNumber) || trainNumber < 1000 || usedNumbers.has(trainNumber)) {
            let attempt = 0;
            do {
                trainNumber = generateSyntheticTrainNumber(source, destination, index, train?.train_name, attempt);
                attempt += 1;
            } while (usedNumbers.has(trainNumber) && attempt < 50);
        }

        usedNumbers.add(trainNumber);
        return {
            ...train,
            train_number: trainNumber
        };
    });
}

function generateFakeTrains(src, dest) {
    const trainNames = [
        "Rajdhani Express",
        "Shatabdi Express", 
        "Duronto Express",
        "Superfast Express"
    ];
    const distance = getDistance(src, dest);
    const duration = Math.ceil(distance / 60);
    const price = Math.round(500 + distance * 0.8);

    const generated = trainNames.map((name, i) => {
        const time = generateTime(duration, i);

        return {
            train_name: `${toTitleCase(src)}-${toTitleCase(dest)} ${trainNames[i % trainNames.length]}`,
            train_number: generateSyntheticTrainNumber(src, dest, i, name),
            departure_time: time.departure,
            arrival_time: time.arrival,
            duration,
            price: price + i * 250
        };
    });

    return ensureUniqueTrainNumbers(generated, src, dest);
}

function parseTrainStringToObject(trainText, source, destination, index) {
    if (!trainText || typeof trainText !== "string") {
        return null;
    }

    const nameMatch = trainText.match(/^(.+?)\s*\(/);
    const trainName = (nameMatch?.[1] || trainText).trim();
    const parsedNumberMatch = trainText.match(/\((\d{4,6})\)/);
    const parsedTrainNumber = parsedNumberMatch ? Number(parsedNumberMatch[1]) : NaN;
    const trainNumber = Number.isFinite(parsedTrainNumber)
        ? parsedTrainNumber
        : generateSyntheticTrainNumber(source, destination, index, trainName);

    const timeMatch = trainText.match(/(\d{1,2}:\d{2})\s*→\s*(\d{1,2}:\d{2}(?:\+\d+)?)/);
    const depArrMatch = trainText.match(/Dep:\s*(\d{1,2}:\d{2})\s*Arr:\s*(\d{1,2}:\d{2}(?:\+\d+)?)/i);
    const resolvedTimeMatch = depArrMatch || timeMatch;
    const distanceDuration = Math.ceil(getDistance(source, destination) / 60);
    const generatedTime = generateTime(distanceDuration, index);
    const departureTime = resolvedTimeMatch?.[1] || generatedTime.departure;
    const arrivalTime = resolvedTimeMatch?.[2] || generatedTime.arrival;

    const durationMatch = trainText.match(/~\s*(\d+(?:\.\d+)?)\s*h/i);
    const duration = durationMatch ? Number(durationMatch[1]) : distanceDuration;

    const priceMatch = trainText.match(/(?:₹|Rs\s?)([\d,]+)/i);
    const price = priceMatch ? Number(priceMatch[1].replace(/,/g, "")) : Math.round(500 + getDistance(source, destination) * 0.8 + index * 250);

    return {
        train_name: trainName || `${toTitleCase(source)}-${toTitleCase(destination)} Express`,
        train_number: trainNumber,
        departure_time: departureTime,
        arrival_time: arrivalTime,
        duration,
        price
    };
}

function normalizeTrainObject(train, source, destination, index) {
    if (!train) {
        return null;
    }

    if (typeof train === "string") {
        return parseTrainStringToObject(train, source, destination, index);
    }

    const trainName = train.train_name || train.name || `${toTitleCase(source)}-${toTitleCase(destination)} Express`;
    const fallbackDuration = Math.ceil(getDistance(source, destination) / 60);
    const generatedTime = generateTime(fallbackDuration, index);
    const providedTrainNumber = Number(train.train_number || train.number);
    const trainNumber = Number.isFinite(providedTrainNumber)
        ? providedTrainNumber
        : generateSyntheticTrainNumber(source, destination, index, trainName);
    const departureTime = train.departure_time || train.departure || generatedTime.departure;
    const arrivalTime = train.arrival_time || train.arrival || generatedTime.arrival;
    const duration = Number(train.duration) || fallbackDuration;
    const price = Number(train.price) || Math.round(500 + getDistance(source, destination) * 0.8 + index * 250);

    return {
        train_name: String(trainName),
        train_number: trainNumber,
        departure_time: String(departureTime),
        arrival_time: String(arrivalTime),
        duration,
        price
    };
}

function normalizeSmartTrains(trains, source, destination) {
    if (!Array.isArray(trains) || trains.length === 0) {
        return generateFakeTrains(source, destination);
    }

    const normalized = trains
        .slice(0, 3)
        .map((train, index) => normalizeTrainObject(train, source, destination, index))
        .filter(Boolean);

    return normalized.length > 0
        ? ensureUniqueTrainNumbers(normalized, source, destination)
        : generateFakeTrains(source, destination);
}

function getBestTrains(trains) {
    const safeTrains = Array.isArray(trains) ? trains.filter(Boolean) : [];
    if (safeTrains.length === 0) {
        return { cheapest: null, fastest: null };
    }

    const cheapest = safeTrains.reduce((a, b) => (a.price < b.price ? a : b));
    const fastest = safeTrains.reduce((a, b) => (a.duration < b.duration ? a : b));

    return { cheapest, fastest };
}

function generatePreferenceTrains(preference, source, destination, count = 2) {
    const pref = (preference || "").toLowerCase();
    const ranges = {
        morning: [5, 11],
        afternoon: [12, 16],
        evening: [17, 20],
        night: [21, 23]
    };
    const [startHour, endHour] = ranges[pref] || [6, 10];

    return Array.from({ length: count }).map((_, index) => {
        const hourSpan = Math.max(1, endHour - startHour + 1);
        const departureHour = startHour + (index % hourSpan);
        const duration = Math.ceil(getDistance(source, destination) / 60);
        const arrivalHour = (departureHour + duration) % 24;
        const dayOffset = Math.floor((departureHour + duration) / 24);

        return {
            train_name: `${toTitleCase(source)}-${toTitleCase(destination)} ${toTitleCase(pref)} Express`,
            train_number: 40000 + index * 1111,
            departure_time: `${String(departureHour).padStart(2, "0")}:00`,
            arrival_time: `${String(arrivalHour).padStart(2, "0")}:00${dayOffset ? `+${dayOffset}` : ""}`,
            duration,
            price: Math.round(500 + getDistance(source, destination) * 0.8 + index * 250)
        };
    });
}

function filterTrainsByPreference(trains, preference) {
    // preference: morning, afternoon, evening, night
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
        if (typeof t === 'string') return { raw: t, hour: parseTrainStartHour(t) };
        const departure = t.departure_time || t.departure || "";
        const hour = Number(String(departure).match(/^(\d{1,2})/)?.[1]);
        return { raw: t, hour: Number.isFinite(hour) ? hour : null };
    });

    return withHours.filter(w => isMatch(w.hour)).map(w => w.raw);
}

// Get food availability info based on train type and duration
function getFoodInfo(train) {
    if (!train) return '❓ Food: Check details';
    
    const name = (train.train_name || '').toLowerCase();
    const duration = train.duration || 0;
    
    // Premium trains with included food
    if (name.includes('rajdhani') || name.includes('shatabdi') || name.includes('duronto')) {
        return '🍱 Food: Included in ticket';
    }
    
    // Long journey (>= 12 hours)
    if (duration >= 12) {
        if (duration > 20) {
            return '🍴 Food: Available (paid) 🥗 E-catering available | 💡 Carry extra food';
        }
        return '🍴 Food: Available (paid) 🥗 E-catering available';
    }
    
    // Short journey
    return '❌ Food: Not available 🥗 E-catering available';
}

function formatTrainLine(train, index) {
    const normalized = normalizeTrainObject(train, "", "", index);
    if (!normalized) {
        return `${index + 1}) Train details unavailable`;
    }
    
    const foodInfo = getFoodInfo(normalized);
    return `${index + 1}) ${normalized.train_name} (${normalized.train_number})\n🕒 ${normalized.departure_time} → ${normalized.arrival_time} (${normalized.duration}h)\n💰 ₹${normalized.price}\n${foodInfo}`;
}

// Build the enhanced response with time suggestions
async function buildRoutePlanResponse(route, travelDate = "") {
    const specialPlan = buildPhagwaraNallagandlaPlan(route);
    if (specialPlan) {
        return travelDate
            ? `${specialPlan}\n\nTravel date: ${travelDate}`
            : `${specialPlan}\n\n🗓️ Select your travel date to see train options for this route.`;
    }

    const source = toTitleCase(route.source);
    const destination = toTitleCase(route.destination);

    const localDistance = distances[getRouteKey(route.source, route.destination)];
    const liveDistance = await getLiveDistance(route.source, route.destination);
    const approxDistance = liveDistance ? null : await getApproxDistance(route.source, route.destination);
    const dynamicDistance = liveDistance || approxDistance;
    const distance = localDistance || dynamicDistance?.km || 0;
    const displayDistance = distance || 900;

    const liveTrains = await getLiveTrains(route.source, route.destination);
    const directTrains = getDirectTrains(route);
    const baseTrains = directTrains.length ? directTrains : liveTrains;
    const trains = normalizeSmartTrains(baseTrains, route.source, route.destination);
    const { cheapest, fastest } = getBestTrains(trains);
    const trainLines = trains.map((train, i) => formatTrainLine(train, i)).join("\n\n");

    if (!travelDate) {
        return [
            `Route plan: ${source} → ${destination}`,
            "",
            `Distance: ~${displayDistance} km`,
            `Duration: ${calculateTravelTime(displayDistance)}`,
            "",
            "🗓️ Select your travel date to see all trains for this route."
        ].join("\n");
    }

    return [
        `Route plan: ${source} → ${destination}`,
        "",
        `Travel date: ${travelDate}`,
        "",
        `Distance: ~${displayDistance} km`,
        `Duration: ${calculateTravelTime(displayDistance)}`,
        "",
        "🚆 Available trains:",
        trainLines,
        "",
        "🏆 Best options:",
        "",
        "⚡ Fastest:",
        fastest ? `${fastest.train_name} (${fastest.duration}h)` : "No fastest option available",
        "",
        "💰 Cheapest:",
        cheapest ? `${cheapest.train_name} (₹${cheapest.price})` : "No cheapest option available",
        "",
        "✅ Train options shown for the selected date.",
    ].join("\n");
}

async function buildLocalTransitResponse(message, sessionId) {
    const text = (message || "").toLowerCase();
    const { source, destination } = extractRoutePlaces(message);
    const stateClarification = buildStateClarificationResponse({ source, destination }, message);
    const travelDetails = extractTravelDetails(message);
    const extractedTravelDate = extractTravelDate(message);
    const sessionRoute = routeContextBySession.get(sessionId);
    const currentRoute = source && destination
        ? { source, destination }
        : sessionRoute;

    // If user replies with a time preference (Morning/Afternoon/Evening/Night)
    const prefMatch = text.match(/\b(morning|afternoon|evening|night)\b/i);
    if (prefMatch && currentRoute?.source && currentRoute?.destination) {
        const preference = prefMatch[1].toLowerCase();
        const effectivePreference = preference === 'morning' ? 'afternoon' : preference;
        const displayPreferenceLabel = effectivePreference.charAt(0).toUpperCase() + effectivePreference.slice(1);

        // Special case: Delhi -> Phagwara fixed demo schedule (date-aware)
        if (currentRoute.source.toLowerCase() === 'delhi' && currentRoute.destination.toLowerCase() === 'phagwara') {
            const selectedTravelDate = extractedTravelDate;
            const travelDate = selectedTravelDate || '2026-05-23';

            const fixedTrains = [
                { bucket: 'afternoon', name: 'Sachkhand Exp (12715)', dep: '13:20', arr: '18:40', fare: '₹350', food: 'Food: Not available (E-catering available)' },
                { bucket: 'night', name: 'Jhelum Express (11077)', dep: '21:00', arr: '03:20', fare: '₹300', food: 'Food: Not available (E-catering available)' },
                { bucket: 'evening', name: 'Shatabdi Exp (12013)', dep: '16:30', arr: '21:30', fare: '₹850', food: 'Food: Included in ticket' }
            ];

            const normalizeBucket = (pref) => {
                if (pref === 'morning') return 'afternoon';
                if (pref === 'afternoon') return 'afternoon';
                if (pref === 'evening') return 'evening';
                if (pref === 'night') return 'night';
                return 'evening';
            };

            const chosen = fixedTrains.find(t => t.bucket === normalizeBucket(effectivePreference)) || fixedTrains[0];

            return [
                `Trains for ${displayPreferenceLabel} travel (${toTitleCase(currentRoute.source)} → ${toTitleCase(currentRoute.destination)}):`,
                `Travel date: ${travelDate}`,
                `1) ${chosen.name}`,
                `🕒 ${chosen.dep} → ${chosen.arr} (6h)`,
                `💰 ${chosen.fare}`,
                `🍱 ${chosen.food.replace(/^Food:\s*/i, '')}`,
                ``,
                `Distance: ~370 km`,
                `Fare estimate:`,
                `- Sleeper: Rs 200-Rs 300`,
                `- AC: Rs 600-Rs 1200`
            ].join('\n');
        }

        const localDistance = distances[getRouteKey(currentRoute.source, currentRoute.destination)];
        const liveDistance = await getLiveDistance(currentRoute.source, currentRoute.destination);
        const approxDistance = liveDistance ? null : await getApproxDistance(currentRoute.source, currentRoute.destination);
        const dynamicDistance = liveDistance || approxDistance;
        const distance = localDistance || dynamicDistance?.km || 0;
        const distanceLine = dynamicDistance?.text
            ? `Distance: ${dynamicDistance.text}`
            : distance
                ? `Distance: ${formatDistanceRange(distance)}`
                : "Distance: check online";
        const fare = estimateFareRange(distance);
        const liveTrains = await getLiveTrains(currentRoute.source, currentRoute.destination);
        const directTrains = getDirectTrains(currentRoute);
        const baseTrains = directTrains.length ? directTrains : liveTrains;
        const smartTrains = normalizeSmartTrains(baseTrains, currentRoute.source, currentRoute.destination);
        let filtered = filterTrainsByPreference(smartTrains, effectivePreference);
        if (filtered.length === 0) {
            filtered = generatePreferenceTrains(effectivePreference, currentRoute.source, currentRoute.destination);
        }

        const responseTrains = filtered.length ? filtered : smartTrains.slice(0, 3);
        const trainLines = responseTrains.slice(0, 3).map((t, i) => formatTrainLine(t, i));

        return [
            `Trains for ${displayPreferenceLabel} travel (${toTitleCase(currentRoute.source)} → ${toTitleCase(currentRoute.destination)}):`,
            ...(extractedTravelDate ? [`Travel date: ${extractedTravelDate}`] : []),
            ...trainLines,
            "",
            distanceLine,
            "Fare estimate:",
            `- Sleeper: ${fare.sleeper}`,
            `- AC: ${fare.ac}`
        ].join("\n");
    }

    if (stateClarification) {
        return stateClarification;
    }

    if (source && destination) {
        routeContextBySession.set(sessionId, { source, destination });
        // Always build a full response for a valid route
        return await buildRoutePlanResponse({ source, destination }, extractedTravelDate);
    }

    if (currentRoute?.source && currentRoute?.destination && (text.includes("route") || text.includes("plan") || text.includes("timing") || text.includes("schedule"))) {
        return await buildRoutePlanResponse(currentRoute);
    }

    const trainedResponse = buildTrainedTransitResponse(text, currentRoute, travelDetails);
    if (trainedResponse) {
        return trainedResponse;
    }

    if (text.includes("irctc") || text.includes("ntes") || text.includes("search")) {
        if (currentRoute?.source && currentRoute?.destination) {
            return [
                `Search step for ${currentRoute.source} to ${currentRoute.destination}:`,
                "1) Open IRCTC or NTES and enter the exact source and destination stations.",
                "2) Match station names carefully, because nearby stations can show different results.",
                "3) Check departure time and journey duration before choosing the train.",
                "4) Save the train number so you can check live running status later."
            ].join("\n");
        }

        return "Open IRCTC or NTES, enter your source and destination station names, then compare departure time, arrival time, and journey duration.";
    }

    if ((text.includes("route") || text.includes("plan")) && (travelDetails.start || travelDetails.end || travelDetails.duration || travelDetails.price)) {
        const routeName = currentRoute?.source && currentRoute?.destination
            ? `${currentRoute.source} to ${currentRoute.destination}`
            : source && destination
                ? `${source} to ${destination}`
                : "your trip";

        const startLine = travelDetails.start ? `Start time: ${travelDetails.start.toUpperCase()}.` : "";
        const endLine = travelDetails.end ? `End time: ${travelDetails.end.toUpperCase()}.` : "";
        const durationLine = travelDetails.duration ? `Total duration: ${travelDetails.duration} hours.` : "";
        const priceLine = travelDetails.price ? `Estimated price: Rs ${travelDetails.price}.` : "";

        return [
            `Sample route plan for ${routeName}:`,
            startLine,
            endLine,
            durationLine,
            priceLine,
            "1) Check the fastest train that matches your departure and arrival window.",
            "2) Compare the ticket cost with any bus alternative before booking.",
            "3) Confirm the platform and live running status before leaving.",
            "4) If you want, I can also give you a shorter version of this plan for the demo."
        ].filter(Boolean).join("\n");
    }

    if (text.includes("filter") || text.includes("zero-change") || text.includes("direct train")) {
        if (currentRoute?.source && currentRoute?.destination) {
            return [
                `Direct-train check for ${currentRoute.source} to ${currentRoute.destination}:`,
                "1) Search IRCTC or NTES for the exact source and destination stations.",
                "2) Enable filters for direct trains or zero-change journeys.",
                "3) Compare departure time, travel time, and arrival time.",
                "4) Prefer confirmed or RAC tickets if you want a safer trip plan.",
                "5) Cross-check platform and running status before travel."
            ].join("\n");
        }

        return "To check direct trains: search your source and destination in IRCTC or NTES, filter for direct or zero-change trains, compare departure and arrival times, and confirm platform details before travel.";
    }

    if (text.includes("compare") || text.includes("time") || text.includes("arrival")) {
        if (currentRoute?.source && currentRoute?.destination) {
            return [
                `Timing comparison for ${currentRoute.source} to ${currentRoute.destination}:`,
                "- Fastest option: shortest journey time.",
                "- Cheapest option: usually bus or non-AC train, but may take longer.",
                "- Best balance: a train with a convenient departure and confirmed seat.",
                "Check both departure time and arrival time, not just the ticket price."
            ].join("\n");
        }

        return "Compare departure time, arrival time, total journey duration, and ticket cost to choose the best option.";
    }

    if (text.includes("status") || text.includes("running") || text.includes("platform")) {
        if (currentRoute?.source && currentRoute?.destination) {
            return [
                `Live-check steps for ${currentRoute.source} to ${currentRoute.destination}:`,
                "1) Use the train number from your search result.",
                "2) Check the running status in NTES or the railway app.",
                "3) Confirm the platform number close to departure time.",
                "4) Watch for delays or platform changes before heading out."
            ].join("\n");
        }

        return "Use the train number to check live running status and platform updates in NTES or the official railway app.";
    }

    if (text.includes("morning") || text.includes("afternoon") || text.includes("night")) {
        if (currentRoute?.source && currentRoute?.destination) {
            return [
                `Sample travel plan for ${currentRoute.source} to ${currentRoute.destination}:`,
                "Morning: best if you want the earliest same-day arrival.",
                "Afternoon: good balance of convenience and seat availability.",
                "Night: often better for sleeper options and lower crowding.",
                "Pick the option that matches your arrival priority and ticket availability."
            ].join("\n");
        }

        return "Morning is best for earliest arrival, afternoon balances convenience, and night is useful for sleeper journeys and less crowding.";
    }

    if (currentRoute?.source && currentRoute?.destination) {
        return [
            `Route guidance for ${currentRoute.source} to ${currentRoute.destination}:`,
            "1) Check direct trains first if this is an intercity trip.",
            "2) If no direct train exists, find the nearest major junction and plan one transfer.",
            "3) Compare train and bus by total duration, cost, and arrival time.",
            "4) Verify live timing, platform, and service alerts in official apps before travel.",
            "If you want, ask me for a direct train check, morning/afternoon/night plan, or fare guidance."
        ].join("\n");
    }

    if (text.includes("fare") || text.includes("price") || text.includes("ticket")) {
        return "For fare checks, use the official transit app or station counter for exact pricing. If you share your city and trip type, I can help estimate a likely fare range.";
    }

    if (text.includes("delay") || text.includes("late") || text.includes("cancel")) {
        return "For delays or cancellations, check the official service status page or station alerts. If you share the route number or station pair, I can help you plan an alternate option.";
    }

    if (text.includes("route") || text.includes("from") || text.includes("to")) {
        return [
            "Example route plan:",
            "Route: Delhi to Phagwara by train.",
            "Departure: 4:00 PM.",
            "Arrival: 10:00 PM.",
            "Total duration: about 5-6 hours.",
            "Fare estimate: Sleeper around Rs 175, AC around Rs 420.",
            "1) Check for a direct train first.",
            "2) Compare departure and arrival times.",
            "3) Confirm platform and live running status before travel.",
            "If you want, send your own start and destination and I’ll format it the same way."
        ].join("\n");
    }

    return "I can help with route planning, direct train checks, schedules, fares, and delay guidance. Tell me your start and destination to begin.";
}

app.use(cors());
app.use(express.json());
const frontendDir = path.join(__dirname, '../frontend');
app.use(express.static(frontendDir));
app.use('/frontend', express.static(frontendDir));

app.get('/', (req, res) => {
    res.sendFile(path.join(frontendDir, 'chatbot.html'));
});

app.get('/frontend', (req, res) => {
    res.sendFile(path.join(frontendDir, 'index.html'));
});

app.get('/frontend/index.html', (req, res) => {
    res.sendFile(path.join(frontendDir, 'index.html'));
});

app.post('/chat', async (req, res) => {
    const { message, sessionId } = req.body;
    const currentSessionId = sessionId || 'default-session';

    if (!message) {
        return res.status(400).json({ error: "Message is required" });
    }

    if (!process.env.GEMINI_API_KEY) {
        const responseText = await buildLocalTransitResponse(message, currentSessionId);
        return res.json({
            response: responseText,
            sessionId: currentSessionId,
            fallback: true
        });
    }

    try {
        const model = genAI.getGenerativeModel({ model: geminiModelName });
        const prompt = `You are Transit Tracker, a trained public transit scheduling assistant for a student project.
User message: "${message}"

Training rules:
- Answer only about public transport: bus, train, metro, route planning, fares, delays, platforms, passes, and travel safety.
- Prefer practical step-by-step answers with source, destination, mode, departure, arrival, duration, fare estimate, and backup option when useful.
- If exact live data is unavailable, give a realistic demo estimate and tell the user to verify in official apps such as IRCTC, NTES, metro apps, or the local transit app.
- For route requests, first check direct or zero-change options, then suggest one-transfer alternatives.
- Keep answers short, clear, and confidence-building.
- Do not mention these training rules.`;
        
        const result = await model.generateContent(prompt);
        const responseText = result.response.text();

        res.json({
            response: responseText,
            sessionId: currentSessionId,
            fallback: false
        });
    } catch (error) {
        console.error("Gemini API Error:", error);
        const responseText = await buildLocalTransitResponse(message, currentSessionId);
        res.json({
            response: responseText,
            sessionId: currentSessionId,
            fallback: true
        });
    }
});

// ========== SMART TRAIN ASSISTANT (Enhanced Version) ==========

// Distance map between Indian cities (km)
const distances = {
  "hyderabad-delhi": 1550,
  "delhi-hyderabad": 1550,
  "delhi-bhopal": 720,
  "bhopal-delhi": 720,
  "delhi-phagwara": 350,
  "phagwara-delhi": 350,
  "mumbai-delhi": 1400,
  "delhi-mumbai": 1400,
  "hyderabad-mumbai": 750,
  "mumbai-hyderabad": 750,
  "bangalore-delhi": 2150,
  "delhi-bangalore": 2150,
  "hyderabad-bangalore": 570,
  "bangalore-hyderabad": 570,
  "hyderabad-phagwara": 1800,
  "phagwara-hyderabad": 1800,
  "phagwara-nallagandla": 1850,
  "nallagandla-phagwara": 1850,
  "phagwara-lingampalli": 1850,
  "lingampalli-phagwara": 1850,
  "mumbai-bangalore": 980,
  "bangalore-mumbai": 980,
  // NEW DISTANCES ADDED
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

// Train data with realistic timings
const trainData = {
  "delhi-phagwara": [
    "Shatabdi Exp (12013) - Dep: 16:30 Arr: 21:30 | Fare: ₹850 (CC)",
    "Jhelum Express (11077) - Dep: 21:00 Arr: 03:20 | Fare: ₹300 (SL), ₹800 (3A)",
    "Sachkhand Exp (12715) - Dep: 13:20 Arr: 18:40 | Fare: ₹350 (SL), ₹900 (3A)"
  ],
  "phagwara-delhi": [
    "Shatabdi Exp (12014) - Dep: 06:30 Arr: 11:30 | Fare: ₹850 (CC)",
    "Jhelum Express (11078) - Dep: 08:00 Arr: 14:20 | Fare: ₹300 (SL), ₹800 (3A)",
    "Sachkhand Exp (12716) - Dep: 05:20 Arr: 10:40 | Fare: ₹350 (SL), ₹900 (3A)"
  ],
  "hyderabad-mumbai": [
    "Hussainsagar Exp (12702) - Dep: 14:50 Arr: 04:55 | Fare: ₹450 (SL), ₹1200 (3A)",
    "Mumbai Express (17032) - Dep: 20:40 Arr: 13:05 | Fare: ₹400 (SL), ₹1100 (3A)",
    "Shatabdi Exp (12026) - Dep: 15:00 Arr: 23:55 | Fare: ₹1300 (CC)"
  ],
  "mumbai-hyderabad": [
    "Hussainsagar Exp (12701) - Dep: 21:50 Arr: 11:55 | Fare: ₹450 (SL), ₹1200 (3A)",
    "Mumbai Express (17031) - Dep: 10:40 Arr: 03:05 | Fare: ₹400 (SL), ₹1100 (3A)",
    "Shatabdi Exp (12025) - Dep: 06:00 Arr: 14:55 | Fare: ₹1300 (CC)"
  ],
  "delhi-mumbai": [
    "Rajdhani Exp (12952) - Dep: 16:55 Arr: 08:35 | Fare: ₹2800 (3A)",
    "Paschim Exp (12926) - Dep: 16:30 Arr: 14:55 | Fare: ₹650 (SL), ₹1700 (3A)",
    "AK Tejas Raj (12954) - Dep: 17:15 Arr: 10:05 | Fare: ₹2900 (3A)"
  ],
  "mumbai-delhi": [
    "Rajdhani Exp (12951) - Dep: 17:00 Arr: 08:32 | Fare: ₹2800 (3A)",
    "Paschim Exp (12925) - Dep: 11:30 Arr: 10:40 | Fare: ₹650 (SL), ₹1700 (3A)",
    "AK Tejas Raj (12953) - Dep: 17:10 Arr: 09:43 | Fare: ₹2900 (3A)"
  ],
  "bangalore-delhi": [
    "Karnataka Exp (12627) - Dep: 19:20 Arr: 09:00 | Fare: ₹900 (SL), ₹2300 (3A)",
    "Rajdhani Exp (22691) - Dep: 20:00 Arr: 05:30 | Fare: ₹3500 (3A)"
  ],
  "delhi-bangalore": [
    "Karnataka Exp (12628) - Dep: 20:20 Arr: 12:00 | Fare: ₹900 (SL), ₹2300 (3A)",
    "Rajdhani Exp (22692) - Dep: 19:50 Arr: 05:20 | Fare: ₹3500 (3A)"
  ],
  "hyderabad-delhi": [
    "Telangana Exp (12723) - Dep: 06:25 Arr: 07:40 | Fare: ₹700 (SL), ₹1800 (3A)",
    "Dakshin Exp (12721) - Dep: 23:00 Arr: 04:00 | Fare: ₹650 (SL), ₹1700 (3A)"
  ],
  "delhi-hyderabad": [
    "Telangana Exp (12724) - Dep: 16:00 Arr: 17:10 | Fare: ₹700 (SL), ₹1800 (3A)",
    "Dakshin Exp (12722) - Dep: 22:50 Arr: 03:50 | Fare: ₹650 (SL), ₹1700 (3A)"
  ],
  "hyderabad-bangalore": [
    "KCG YPR Exp (17603) - Dep: 21:05 Arr: 09:35 | Fare: ₹400 (SL), ₹1050 (3A)",
    "SBC Rajdhani (22692) - Dep: 19:50 Arr: 05:20 | Fare: ₹1800 (3A)"
  ],
  "bangalore-hyderabad": [
    "YPR KCG Exp (17604) - Dep: 15:25 Arr: 05:00 | Fare: ₹400 (SL), ₹1050 (3A)",
    "Rajdhani Exp (22691) - Dep: 20:00 Arr: 05:30 | Fare: ₹1800 (3A)"
  ],
  "delhi-kochi": [
    "Kerala Exp (12626) - Dep: 20:10 Arr: 14:25 | Fare: ₹1050 (SL), ₹2700 (3A)",
    "Mangala Ldweep (12618) - Dep: 05:40 Arr: 07:30 | Fare: ₹1000 (SL), ₹2600 (3A)"
  ],
  "kochi-delhi": [
    "Kerala Exp (12625) - Dep: 11:15 Arr: 13:15 | Fare: ₹1050 (SL), ₹2700 (3A)",
    "Mangala Ldweep (12617) - Dep: 13:25 Arr: 13:20 | Fare: ₹1000 (SL), ₹2600 (3A)"
  ],
  "delhi-nagpur": [
    "Grand Trunk Exp (12616) - Dep: 16:10 Arr: 10:15 | Fare: ₹500 (SL), ₹1300 (3A)",
    "AP Express (20806) - Dep: 20:00 Arr: 13:00 | Fare: ₹550 (SL), ₹1400 (3A)"
  ],
  "nagpur-delhi": [
    "Grand Trunk Exp (12615) - Dep: 17:30 Arr: 05:05 | Fare: ₹500 (SL), ₹1300 (3A)",
    "AP Express (20805) - Dep: 14:20 Arr: 05:40 | Fare: ₹550 (SL), ₹1400 (3A)"
  ],
  "bangalore-kochi": [
    "Kanyakumari Exp (16526) - Dep: 20:10 Arr: 07:10 | Fare: ₹350 (SL), ₹900 (3A)",
    "Kochuveli Exp (16315) - Dep: 16:50 Arr: 04:00 | Fare: ₹330 (SL), ₹850 (3A)"
  ],
  "kochi-bangalore": [
    "Kanyakumari Exp (16525) - Dep: 17:00 Arr: 06:40 | Fare: ₹350 (SL), ₹900 (3A)",
    "Kochuveli Exp (16316) - Dep: 20:30 Arr: 08:30 | Fare: ₹330 (SL), ₹850 (3A)"
  ],
  "delhi-chennai": [
    "Tamil Nadu Exp (12622) - Dep: 21:05 Arr: 06:15 | Fare: ₹900 (SL), ₹2300 (3A)",
    "Grand Trunk Exp (12616) - Dep: 16:10 Arr: 04:30 | Fare: ₹850 (SL), ₹2200 (3A)"
  ],
  "chennai-delhi": [
    "Tamil Nadu Exp (12621) - Dep: 22:00 Arr: 06:30 | Fare: ₹900 (SL), ₹2300 (3A)",
    "Grand Trunk Exp (12615) - Dep: 18:50 Arr: 05:05 | Fare: ₹850 (SL), ₹2200 (3A)"
  ],
  "mumbai-chennai": [
    "CSMT Chennai Exp (22159) - Dep: 12:45 Arr: 10:45 | Fare: ₹600 (SL), ₹1550 (3A)",
    "LTT Chennai Exp (12163) - Dep: 18:40 Arr: 16:30 | Fare: ₹580 (SL), ₹1500 (3A)"
  ],
  "chennai-mumbai": [
    "Chennai CSMT Exp (22160) - Dep: 13:25 Arr: 12:30 | Fare: ₹600 (SL), ₹1550 (3A)",
    "Chennai LTT Exp (12164) - Dep: 18:20 Arr: 15:40 | Fare: ₹580 (SL), ₹1500 (3A)"
  ],
  "bangalore-chennai": [
    "Shatabdi Exp (12028) - Dep: 06:00 Arr: 11:00 | Fare: ₹850 (CC)",
    "Brindavan Exp (12640) - Dep: 15:10 Arr: 21:10 | Fare: ₹200 (2S), ₹700 (CC)"
  ],
  "chennai-bangalore": [
    "Shatabdi Exp (12027) - Dep: 17:30 Arr: 22:25 | Fare: ₹850 (CC)",
    "Brindavan Exp (12639) - Dep: 07:40 Arr: 13:40 | Fare: ₹200 (2S), ₹700 (CC)"
  ],
  "hyderabad-chennai": [
    "Charminar Exp (12760) - Dep: 18:00 Arr: 07:00 | Fare: ₹450 (SL), ₹1150 (3A)",
    "Chennai Exp (12604) - Dep: 16:45 Arr: 05:40 | Fare: ₹420 (SL), ₹1100 (3A)"
  ],
  "chennai-hyderabad": [
    "Charminar Exp (12759) - Dep: 18:10 Arr: 08:10 | Fare: ₹450 (SL), ₹1150 (3A)",
    "Hyderabad Exp (12603) - Dep: 16:45 Arr: 05:45 | Fare: ₹420 (SL), ₹1100 (3A)"
  ],
  "mumbai-pune": [
    "Deccan Queen (12123) - Dep: 17:10 Arr: 20:25 | Fare: ₹150 (2S), ₹550 (CC)",
    "Sinhagad Exp (11009) - Dep: 17:50 Arr: 21:50 | Fare: ₹120 (2S), ₹450 (CC)"
  ],
  "pune-mumbai": [
    "Deccan Queen (12124) - Dep: 07:15 Arr: 10:25 | Fare: ₹150 (2S), ₹550 (CC)",
    "Sinhagad Exp (11010) - Dep: 06:05 Arr: 09:55 | Fare: ₹120 (2S), ₹450 (CC)"
  ],
  "delhi-pune": [
    "Jhelum Express (11078) - Dep: 10:30 Arr: 16:00 | Fare: ₹650 (SL), ₹1750 (3A)",
    "Goa Express (12780) - Dep: 15:15 Arr: 17:10 | Fare: ₹700 (SL), ₹1800 (3A)"
  ],
  "pune-delhi": [
    "Jhelum Express (11077) - Dep: 17:20 Arr: 21:15 | Fare: ₹650 (SL), ₹1750 (3A)",
    "Goa Express (12779) - Dep: 04:30 Arr: 06:25 | Fare: ₹700 (SL), ₹1800 (3A)"
  ],
  "delhi-jaipur": [
    "Ajmer Shatabdi (12015) - Dep: 06:10 Arr: 10:40 | Fare: ₹650 (CC)",
    "Double Decker (12986) - Dep: 17:35 Arr: 22:05 | Fare: ₹550 (CC)"
  ],
  "jaipur-delhi": [
    "Ajmer Shatabdi (12016) - Dep: 17:30 Arr: 22:30 | Fare: ₹650 (CC)",
    "Double Decker (12985) - Dep: 06:00 Arr: 10:25 | Fare: ₹550 (CC)"
  ],
  "hyderabad-pune": [
    "Hussainsagar Exp (12702) - Dep: 14:50 Arr: 01:00 | Fare: ₹380 (SL), ₹1000 (3A)",
    "Shatabdi Exp (12026) - Dep: 15:00 Arr: 23:10 | Fare: ₹1100 (CC)"
  ],
  "pune-hyderabad": [
    "Hussainsagar Exp (12701) - Dep: 01:25 Arr: 12:05 | Fare: ₹380 (SL), ₹1000 (3A)",
    "Shatabdi Exp (12025) - Dep: 06:00 Arr: 14:20 | Fare: ₹1100 (CC)"
  ]
};

// Calculate realistic travel time (hours)
function calculateTravelTime(distance) {
  const minHours = Math.floor(distance / 70);
  const maxHours = Math.ceil(distance / 60);
  return `${minHours}–${maxHours} hours`;
}

// Build smart context for Gemini
function buildTrainContext(from, to) {
  const key = `${from.toLowerCase()}-${to.toLowerCase()}`;
  const distance = distances[key];
  const trains = trainData[key];

  if (!distance) {
    return "";
  }

  let context = `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TRAIN DATA FOR ${from.toUpperCase()} ↔ ${to.toUpperCase()}:
Distance: ${distance} km
Realistic duration: ${calculateTravelTime(distance)}

Available trains:`;

  if (trains && trains.length > 0) {
    trains.forEach((train, idx) => {
      context += `\n${idx + 1}. ${train}`;
    });
  } else {
    context += "\n(Check IRCTC/NTES for latest trains)";
  }

  context += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
  return context;
}

// ASCII-safe overrides used by the smart assistant endpoint.
function calculateTravelTime(distance) {
  const minHours = Math.floor(distance / 70);
  const maxHours = Math.ceil(distance / 60);
  return `${minHours}-${maxHours} hours`;
}

function buildTrainContext(from, to) {
  const key = getRouteKey(from, to);
  const distance = distances[key];
  const trains = trainData[key];

  if (!distance) {
    return "";
  }

  const fare = estimateFare(distance);
  const tips = generateRouteTips(distance, Boolean(trains?.length));
  let context = `ROUTE CONTEXT:
Route: ${from} to ${to}
Distance: ${distance} km
Realistic duration: ${calculateTravelTime(distance)}
Fare estimate:
- Sleeper: Rs ${fare.sleeper}
- AC: Rs ${fare.ac}

IMPORTANT:
- Use this distance and duration only.
- Use this fare estimate only unless the user gives a confirmed fare.
- Do not say 6 hours unless the provided realistic duration is 6 hours.
- Never invent fixed or generic durations.
- Make suggestions based on the route distance and direct-train availability.
- If listing trains, use the provided train options when available.

Available trains:`;

  if (trains && trains.length > 0) {
    trains.forEach((train, idx) => {
      context += `\n${idx + 1}. ${train}`;
    });
  } else {
    context += "\n(Check IRCTC/NTES for latest trains)";
  }

  context += `\n\nSuggested logic:`;
  tips.forEach((tip, idx) => {
    context += `\n${idx + 1}. ${tip}`;
  });

  return context;
}

function extractCitiesForTrainContext(message) {
  const route = extractRoutePlaces(message);
  if (route.source && route.destination) {
    return route;
  }

  const normalized = (message || "").toLowerCase();
  const mentioned = [...new Set(Object.keys(distances).flatMap(key => key.split("-")))]
    .filter(city => new RegExp(`(^|\\W)${city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\W|$)`, "i").test(normalized))
    .sort((a, b) => normalized.indexOf(a) - normalized.indexOf(b));

  if (mentioned.length >= 2) {
    return { source: mentioned[0], destination: mentioned[1] };
  }

  return { source: "", destination: "" };
}

app.post('/api/smart-train-assistant', async (req, res) => {
  const { message, sessionId, source, destination } = req.body;
  const currentSessionId = sessionId || 'default-session';

  if (!message) {
    return res.status(400).json({ error: "Message is required" });
  }

  try {
    const route = extractCitiesForTrainContext(message);
    const stateClarification = buildStateClarificationResponse(route, message);
        const travelDate = extractTravelDate(message);
        const currentRoute = routeContextBySession.get(currentSessionId);
    let trainContext = "";
        const preferenceMatch = message.match(/\b(morning|afternoon|evening|night)\b/i);

    if (stateClarification) {
      return res.json({
        response: stateClarification,
        sessionId: currentSessionId,
        fallback: true
      });
    }

        if (preferenceMatch && (currentRoute?.source && currentRoute?.destination || route.source && route.destination)) {
            const routeToUse = currentRoute?.source && currentRoute?.destination
                ? currentRoute
                : route;

            routeContextBySession.set(currentSessionId, routeToUse);
            return res.json({
                response: await buildLocalTransitResponse(message, currentSessionId),
                sessionId: currentSessionId,
                fallback: true
            });
        }

        if (travelDate) {
            // Prefer session route, but recover from explicit source/destination if present.
            const routeForDate = (currentRoute?.source && currentRoute?.destination)
                ? currentRoute
                : (source && destination ? { source, destination } : null);

            // If we have a complete route for this date, build date-aware train list.
            if (routeForDate?.source && routeForDate?.destination) {
                routeContextBySession.set(currentSessionId, routeForDate);
                return res.json({
                    response: await buildRoutePlanResponse(routeForDate, travelDate),
                    sessionId: currentSessionId,
                    fallback: true
                });
            }
        }

    if (route.source && route.destination) {
      routeContextBySession.set(currentSessionId, route);
      const specialPlan = buildPhagwaraNallagandlaPlan(route);
      if (specialPlan) {
        return res.json({
                    response: await buildRoutePlanResponse(route),
          sessionId: currentSessionId,
          fallback: true
        });
      }
            return res.json({
                response: await buildRoutePlanResponse(route),
                sessionId: currentSessionId,
                fallback: true
            });
    } else {
            if (currentRoute?.source && currentRoute?.destination) {
                if (travelDate) {
                    return res.json({
                        response: await buildRoutePlanResponse(currentRoute, travelDate),
                        sessionId: currentSessionId,
                        fallback: true
                    });
                }

                return res.json({
                    response: await buildRoutePlanResponse(currentRoute),
                    sessionId: currentSessionId,
                    fallback: true
                });
      }
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.json({
        response: await buildLocalTransitResponse(message, currentSessionId),
        sessionId: currentSessionId,
        fallback: true
      });
    }

    const model = genAI.getGenerativeModel({
      model: geminiModelName,
      systemInstruction: `You are a smart Indian railway assistant bot.

CORE RULES:
- Always estimate time from provided route distance at 55-65 km/h average train speed.
- Never invent fixed durations or repeat generic values.
- If route context is provided, its distance and duration are the source of truth.
- Never say 6 hours for a 1550 km route.
- Prefer direct trains when available.
- Keep answers clear, structured, and helpful.
- Always suggest checking IRCTC/NTES for live booking.

RESPONSE FORMAT (when route is given):
Route Plan: From to To
Distance: X km | Duration: X-Y hours
Fare Estimate:
- Sleeper: Rs X
- AC: Rs Y
Recommended Trains: list 2-3 options
Suggestions: condition-based list using distance and direct-train availability`
    });

    const userPrompt = trainContext
      ? `${trainContext}\n\nUser message: ${message}`
      : `User message: ${message}`;

    const result = await model.generateContent(userPrompt);
    const responseText = result.response.text();

    res.json({
      response: responseText,
      sessionId: currentSessionId,
      fallback: false
    });
  } catch (error) {
    console.error("Smart Train Assistant Error:", error);
    res.json({
      response: await buildLocalTransitResponse(message, currentSessionId),
      sessionId: currentSessionId,
      fallback: true
    });
  }
});

// Legacy endpoint kept for reference; the active route above handles production requests.
app.post('/api/smart-train-assistant-legacy', async (req, res) => {
  const { message, sessionId } = req.body;
  const currentSessionId = sessionId || 'default-session';

  if (!message) {
    return res.status(400).json({ error: "Message is required" });
  }

  try {
    // Extract cities from message
    const citiesRegex = /(?:from\s+|to\s+)([A-Za-z]+(?:\s+[A-Za-z]+)*)/gi;
    const matches = message.match(citiesRegex);
    let trainContext = "";

    // Simple extraction for "from X to Y"
    const fromToMatch = message.match(/from\s+([a-zA-Z]+)\s+to\s+([a-zA-Z]+)/i);
    if (fromToMatch) {
      const from = fromToMatch[1];
      const to = fromToMatch[2];
      trainContext = buildTrainContext(from, to);
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.json({
        response: await buildLocalTransitResponse(message, currentSessionId),
        sessionId: currentSessionId,
        fallback: true
      });
    }

    const model = genAI.getGenerativeModel({ model: geminiModelName });

    // SMART SYSTEM PROMPT
    const systemPrompt = `You are a smart Indian railway assistant bot.

CORE RULES:
✓ Always estimate time based on distance at 55-65 km/h average train speed
✓ Never give unrealistic durations (e.g., don't say 6 hours for 1550 km)
✓ Prefer direct trains when available
✓ Provide realistic train names, timings, and fare ranges
✓ Keep answers clear, structured, and helpful
✓ Use bullet points and emojis for readability
✓ Always suggest checking IRCTC/NTES for live booking

RESPONSE FORMAT (when route is given):
📍 Route Plan: From → To
🚆 Distance: X km | Duration: X-Y hours
💰 Estimated Fare: ₹X-Y (by class)
🎫 Recommended Trains: (list 2-3 options)
📋 Steps: 1) Check direct trains 2) Compare timings 3) Book on IRCTC

IMPORTANT: If exact train data is unavailable, provide realistic estimates and always tell user to verify on IRCTC/NTES.`;

    const userPrompt = `${message}${trainContext}`;

    const result = await model.generateContent([
      { text: systemPrompt },
      { text: userPrompt }
    ]);

    const responseText = result.response.text();

    res.json({
      response: responseText,
      sessionId: currentSessionId,
      fallback: false
    });
  } catch (error) {
    console.error("Smart Train Assistant Error:", error);
    res.status(500).json({
      error: "Failed to process request",
      sessionId: currentSessionId
    });
  }
});

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
    console.log(`Gemini model: ${geminiModelName}`);
    console.log('Local transit fallback is enabled');
    console.log(`Smart Train Assistant available at /api/smart-train-assistant`);
    console.log("FINAL SMART BOT RUNNING");
});

// --- Chat storage endpoints (optional) ---
try {
    const Chat = require('./models/Chat');

    function normalizeChatMessage(message) {
        if (!message) {
            return null;
        }

        const sender = message.sender || (message.type && message.type.startsWith('user') ? 'user' : 'bot');
        const text = message.text || message.content || '';
        const time = message.time ? new Date(message.time) : new Date();

        if (!text) {
            return null;
        }

        return { sender, text, time };
    }

    app.post('/api/chats', express.json(), async (req, res) => {
        try {
            const { sessionId, messages, lastRoute } = req.body || {};
            if (!sessionId) {
                return res.status(400).json({ ok: false, error: 'sessionId is required' });
            }

            const normalizedMessages = Array.isArray(messages)
                ? messages.map(normalizeChatMessage).filter(Boolean)
                : [];

            const doc = await Chat.findOneAndUpdate(
                { sessionId },
                {
                    sessionId,
                    messages: normalizedMessages,
                    lastRoute: lastRoute || {}
                },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );
            res.json({ ok: true, id: doc._id });
        } catch (err) {
            console.error('Save chat error:', err);
            res.status(500).json({ ok: false, error: err.message });
        }
    });

    app.get('/api/chats', async (req, res) => {
        try {
            const docs = await Chat.find().sort({ createdAt: -1 }).limit(200);
            res.json(docs);
        } catch (err) {
            console.error('List chats error:', err);
            res.status(500).json({ ok: false, error: err.message });
        }
    });
} catch (e) {
    console.warn('Chat model not available, skipping chat endpoints');
}

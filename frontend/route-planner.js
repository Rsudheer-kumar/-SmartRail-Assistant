// Distance map between Indian cities (in km)
const distances = {
  "hyderabad-delhi": 1550,
  "delhi-hyderabad": 1550,
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
  "mumbai-phagwara": 1650,
  "phagwara-mumbai": 1650
};

// Calculate base travel time (hours)
function calculateTime(distance) {
  const speed = 60; // avg train speed km/h
  const hours = distance / speed;
  return hours;
}

// Get smart time with realistic variation
function getSmartTime(distance) {
  const min = Math.floor(distance / 70);
  const max = Math.ceil(distance / 60);
  
  return `${Math.round(min)}–${Math.round(max)} hours`;
}

function estimateFare(distance) {
  return {
    sleeper: Math.round(distance * 0.5),
    ac: Math.round(distance * 1.2)
  };
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

function normalizeRoutePlace(place) {
  const aliases = {
    "nalla gandla": "nallagandla",
    "lingampalli": "nallagandla",
    "lingampally": "nallagandla"
  };
  const clean = String(place || "").toLowerCase().trim();
  return aliases[clean] || clean;
}

function buildPhagwaraNallagandlaPlan(from, to) {
  const key = `${normalizeRoutePlace(from)}-${normalizeRoutePlace(to)}`;
  if (key !== "phagwara-nallagandla" && key !== "nallagandla-phagwara") {
    return "";
  }

  const distance = distances[key] || 1850;
  const fare = estimateFare(distance);
  const reverse = key === "nallagandla-phagwara";
  const source = reverse ? "Nallagandla" : "Phagwara";
  const destination = reverse ? "Phagwara" : "Nallagandla";
  const mainLeg = reverse
    ? "Board from Lingampalli (LPI), Hyderabad (HYB), or Secunderabad (SC), then travel north toward New Delhi/Jalandhar/Phagwara."
    : "Use Lingampalli (LPI), Hyderabad (HYB), or Secunderabad (SC) as the rail destination because Nallagandla is a locality near Lingampalli.";

  return `Route Plan: ${source} to ${destination}

Distance: ~${distance} km
Duration: ${getSmartTime(distance)}
Fare estimate:
- Sleeper: Rs ${fare.sleeper}
- AC: Rs ${fare.ac}

Direct train check:
Do not assume a direct Phagwara to Nallagandla train. First search PGW to LPI/HYB/SC on IRCTC or NTES.

Alternative train plan:
1) ${mainLeg}
2) If no direct train is available, go Phagwara to New Delhi, then New Delhi to Hyderabad/Secunderabad.
3) From Lingampalli/Hyderabad/Secunderabad, take MMTS, metro plus auto, or cab to Nallagandla.

Suggested trains to compare:
- Phagwara to New Delhi: Shatabdi/Jhelum/Sachkhand type options.
- New Delhi to Hyderabad/Secunderabad: Telangana Express or Dakshin Express type options.

Always verify live train availability and platform on IRCTC/NTES before booking.`;
}

const directRoutes = new Set([
  "hyderabad-delhi",
  "delhi-hyderabad",
  "delhi-phagwara",
  "phagwara-delhi",
  "mumbai-delhi",
  "delhi-mumbai",
  "hyderabad-mumbai",
  "mumbai-hyderabad"
]);

// Smart train fallback - guess expected trains based on distance
function guessExpectedTrains(distance) {
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

function generateTips(distance, hasDirectTrain) {
  const tips = [];

  if (hasDirectTrain) {
    tips.push("Direct train data is available for this route, so prefer a direct train for convenience.");
  } else {
    // Smart fallback - show expected trains instead of saying no data
    const expectedTrains = guessExpectedTrains(distance);
    tips.push("Direct trains are likely available. Check IRCTC/NTES for live availability.");
    tips.push(`Expected trains: ${expectedTrains.join(", ")}`);
  }

  if (distance > 1000) {
    tips.push("This is a long journey, so choose Sleeper or AC based on budget and comfort.");
  } else if (distance > 500) {
    tips.push("This is a medium-distance route, so compare overnight trains with daytime chair-car options.");
  } else {
    tips.push("This is a shorter route, so seating class or chair car may be enough.");
  }

  tips.push("Always verify live running status, platform, and seat availability on IRCTC or NTES before departure.");
  return tips;
}

function getRoutePlan(from, to, travelDate) {
  const specialPlan = buildPhagwaraNallagandlaPlan(from, to);
  if (specialPlan) {
    return {
      error: false,
      message: `${specialPlan}\n\nTravel date: ${formatTravelDate(travelDate)}`
    };
  }

  const key = `${normalizeRoutePlace(from)}-${normalizeRoutePlace(to)}`;
  const distance = distances[key];

  if (!distance) {
    return {
      error: true,
      message: `⚠️ Route data not available for "${from}" to "${to}".
      
Try one of these routes:
• Hyderabad ↔ Delhi
• Hyderabad ↔ Bangalore
• Mumbai ↔ Delhi
• Delhi ↔ Phagwara

Available routes are limited. Please check again with different cities.`
    };
  }

  const timeRange = getSmartTime(distance);
  const fare = estimateFare(distance);
  const hasDirectTrain = directRoutes.has(key);
  const tips = generateTips(distance, hasDirectTrain);
  const response = `
📍 Route Plan: ${from} → ${to}

📅 Travel date: ${formatTravelDate(travelDate)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚆 Distance: ${distance} km
⏱️ Duration: ${timeRange} (depending on train)
✅ Mode: Train Recommended

━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🛤️ How to Book:

1️⃣ Visit IRCTC or NTES website
   Search "${from}" to "${to}"

2️⃣ Choose Direct Trains First
   • Fastest option available
   • Fewer stops = Less travel time

3️⃣ Check Train Details
   • Departure: Morning/Evening preferred
   • Arrival: Check timing
   • Seat availability

4️⃣ Confirm Before Departure
   • Check live train status
   • Note platform number
   • Reach station 30 mins early

━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💡 Pro Tips:
👉 If no direct train, use 1-stop via major junction
👉 Weekend trains are usually crowded
👉 Premium trains cost more but save time
👉 Always keep ticket printed or digital copy

Safe travels! 🎫`;

  return { error: false, message: response };
}

// DOM elements
const routeForm = document.getElementById('route-form');
const fromCityInput = document.getElementById('from-city');
const toCityInput = document.getElementById('to-city');
const travelDateInput = document.getElementById('travel-date');
const routesContainer = document.getElementById('routes-container');

if (travelDateInput) {
  const today = new Date();
  const maxDate = new Date();
  maxDate.setDate(today.getDate() + 60);
  travelDateInput.min = formatDateForInput(today);
  travelDateInput.max = formatDateForInput(maxDate);
  travelDateInput.value = localStorage.getItem('selectedTravelDate') || '';
}

// Handle form submission
if (routeForm && fromCityInput && toCityInput && routesContainer) {
  routeForm.addEventListener('submit', function(e) {
    e.preventDefault();

    const from = fromCityInput.value.trim();
    const to = toCityInput.value.trim();
    const travelDate = travelDateInput ? travelDateInput.value : '';

    if (!from || !to) {
      routesContainer.innerHTML = '<p style="color: red;">Please enter both cities.</p>';
      return;
    }

    if (!travelDate) {
      routesContainer.innerHTML = '<p style="color: red;">Please select a travel date before getting the route plan.</p>';
      return;
    }

    if (from.toLowerCase() === to.toLowerCase()) {
      routesContainer.innerHTML = '<p style="color: red;">Source and destination should be different!</p>';
      return;
    }

    localStorage.setItem('selectedTravelDate', travelDate);

    const result = getRoutePlan(from, to, travelDate);

    // Display result
    routesContainer.innerHTML = '';
    const resultDiv = document.createElement('div');
    resultDiv.className = result.error ? 'route-result error' : 'route-result success';
    resultDiv.innerHTML = `<pre>${result.message}</pre>`;
    routesContainer.appendChild(resultDiv);
  });
}

// Optional: Show available routes on page load
document.addEventListener('DOMContentLoaded', function() {
  const availableRoutesText = `
✈️ Available Routes:

These routes have real distance data:
• Hyderabad ↔ Delhi (1550 km)
• Hyderabad ↔ Bangalore (570 km)
• Mumbai ↔ Delhi (1400 km)
• Hyderabad ↔ Mumbai (750 km)
• Bangalore ↔ Delhi (2150 km)
• Delhi ↔ Phagwara (350 km)

🔍 Enter any two cities from above to get a route plan!
  `;
  
  const infoDiv = document.createElement('div');
  infoDiv.className = 'route-info';
  infoDiv.innerHTML = `<pre>${availableRoutesText}</pre>`;
  
  if (routesContainer) {
    routesContainer.appendChild(infoDiv);
  }
}); 

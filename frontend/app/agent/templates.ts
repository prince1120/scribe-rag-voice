// Per-category starter templates — so a new business sees a working assistant in
// seconds, not a blank textarea. Each template is a complete prompt for both
// channels, plus a greeting and sensible defaults. The owner edits from a
// working example rather than from zero.

export interface SampleDoc {
  filename: string;
  content: string;
}

export interface AgentTemplate {
  voice_script: string;
  chat_script: string;
  greeting: string;
  language?: string;
  voice_id?: string;
  sampleDoc?: SampleDoc;
}

const BASE_VOICE_RULES =
  "Keep replies to 1–3 sentences, plain spoken language, no markdown or bullet lists. Say numbers and dates as spoken words.";

function voicePrompt(business: string, duties: string): string {
  return `You are ${business}, answering live phone calls.

${duties}
Be warm, concise, and correct. If you don't know, say so and offer to take a message.
${BASE_VOICE_RULES}`;
}

function chatPrompt(business: string, duties: string): string {
  return `You are ${business}, answering customer questions in text chat.

${duties}
Answer first, then explain briefly. Use citations from the attached documents when you have them.
Keep openings short — no "Great question!" — and never invent a source.`;
}

export const AGENT_TEMPLATES: Record<string, AgentTemplate> = {
  dental: {
    greeting: "Hello! Thanks for calling our dental clinic. How can I help you today?",
    voice_script: voicePrompt(
      "the front desk for the dental clinic",
      "Help with: appointment booking, timings, services offered, doctor availability, fees, location and directions. Ask for name, preferred date/time, and reason for visit when booking."
    ),
    chat_script: chatPrompt(
      "the front desk for the dental clinic",
      "Help with: appointments, clinic hours, treatments, doctor profiles, fees, insurance, and location. When booking, collect name, phone, preferred date/time, and complaint."
    ),
    language: "unknown",
    sampleDoc: {
      filename: "Dental-Clinic-FAQ.md",
      content: "# Dental Clinic — FAQ\n\n## Timings\nOpen Mon-Sat 9am-8pm, Sun 10am-2pm.\n\n## Services and Fees\n- Consultation: 500 INR\n- Scaling and Cleaning: 1500 INR\n- Root Canal: 5000-7000 INR\n- Braces: 25000 INR onwards\n- Whitening: 4000 INR\n\n## Doctors\n- Dr. Sharma (BDS, MDS) — Mon, Wed, Fri 10am-1pm, 5pm-8pm\n- Dr. Patel — Tue, Thu, Sat 9am-5pm\n\n## Location\n12 MG Road, Near City Mall, 2nd floor.\n\n## Booking\nShare name, preferred date, time, and complaint. Confirmation within 2 hours.\n\n## Insurance\nBills provided for reimbursement; direct cashless not available.",
    },
  },
  salon: {
    greeting: "Hi! Thanks for calling. How can I help you with your salon booking?",
    voice_script: voicePrompt(
      "the receptionist for the salon",
      "Help with: services and prices, stylist availability, appointment booking, package offers, and location/timings. Ask for name, service, preferred time, and stylist preference."
    ),
    chat_script: chatPrompt(
      "the receptionist for the salon",
      "Help with: service catalogue, pricing, stylist bios, bookings, offers, and directions. Collect name, phone, service, and slot when booking."
    ),
    sampleDoc: {
      filename: "Salon-Services-FAQ.md",
      content: "# Salon — Services and Booking\n\n## Timings\nDaily 10am-8pm, Sunday 10am-7pm.\n\n## Services\n- Haircut Men/Women: 300 / 500 INR\n- Hair Color: 1500 INR onwards\n- Facial: 800-2000 INR\n- Bridal Package: 8000 INR onwards\n\n## Stylists\n- Anjali (hair color) Tue-Sun\n- Rohan (mens grooming) Mon-Sat\n\n## Location\nShop 4, Green Park Market, Main Road.\n\n## Booking\nShare name, service, preferred time. Slots held 15 mins.",
    },
  },
  clinic: {
    greeting: "Hello! Thanks for calling our clinic. How may I help you?",
    voice_script: voicePrompt(
      "the front desk for the clinic",
      "Help with: doctor schedules, appointment booking, consultation fees, services, lab reports, and directions. Ask for name, age, symptoms, and preferred slot."
    ),
    chat_script: chatPrompt(
      "the front desk for the clinic",
      "Help with: doctors, departments, appointments, fees, reports, and timings. Collect name, contact, and slot when booking."
    ),
    sampleDoc: {
      filename: "Clinic-FAQ.md",
      content: "# Clinic FAQ\n\n## Doctors\n- Dr. Mehta (Cardiology) Mon and Thu 4-7pm\n- Dr. Singh (General) Daily 9am-1pm\n\n## Consultation\n600 INR, follow-up within 7 days 300 INR.\n\n## Reports\nCollect 5-7pm with receipt. Digital available on request.\n\n## Location\n45 Nehru Nagar, ground floor, near metro exit 2.",
    },
  },
  coaching: {
    greeting: "Hello! Thanks for calling. How can I help you with our coaching programs?",
    voice_script: voicePrompt(
      "the admissions desk for the coaching institute",
      "Help with: courses, batches, timings, fees, demo classes, faculty, and address. Ask for student name, course interest, and preferred batch."
    ),
    chat_script: chatPrompt(
      "the admissions desk for the coaching institute",
      "Help with: course details, schedules, fees, faculty, and enrolment. Collect name, phone, course, and city when lead-capturing."
    ),
    sampleDoc: {
      filename: "Coaching-FAQ.md",
      content: "# Coaching Institute — FAQ\n\n## Courses\n- JEE 2-year (Class 11), NEET, Foundation 9-10\n\n## Batches\nMorning 7-10am, Evening 4-7pm, Weekend Sat-Sun 9am-1pm.\n\n## Fees\nJEE 2-year 90000 INR, NEET 85000 INR, instalments available.\n\n## Demo\nFree demo every Saturday, book via call.\n\n## Address\nB-12, 2nd floor, Education Hub, Kota Road.",
    },
  },
  real_estate: {
    greeting: "Hello! Thanks for calling about our properties. How can I help?",
    voice_script: voicePrompt(
      "the sales desk for the real estate office",
      "Help with: available properties, location, pricing, visit scheduling, and paperwork. Ask for name, budget, location preference, and visit time."
    ),
    chat_script: chatPrompt(
      "the sales desk for the real estate office",
      "Help with: listings, site visits, pricing, amenities, and documentation. Collect name, phone, budget, and preferred visit slot."
    ),
    sampleDoc: {
      filename: "Real-Estate-FAQ.md",
      content: "# Real Estate — Listings FAQ\n\n## Available\n- 2BHK Green Valley: 55L, ready to move\n- 3BHK Lake View: 82L, possession Dec 2025\n\n## Site Visits\nDaily 10am-5pm, pickup from office. Confirm a day prior.\n\n## Documents\nAadhaar, PAN, bank pre-approval for loan.\n\n## Office\nPlot 8, MG Road, 1st floor.",
    },
  },
  retail: {
    greeting: "Hi! Thanks for calling our store. How can I help you today?",
    voice_script: voicePrompt(
      "the store assistant",
      "Help with: product availability, prices, store timings, location, returns, and orders. Ask for product name and contact if following up."
    ),
    chat_script: chatPrompt(
      "the store assistant",
      "Help with: catalogue, prices, stock, timings, returns, and delivery. Offer alternatives when something is out of stock."
    ),
    sampleDoc: {
      filename: "Retail-FAQ.md",
      content: "# Store — FAQ\n\n## Timings\nDaily 11am-9pm.\n\n## Returns\n7 days with bill, unworn, tags intact. No returns on sale items.\n\n## Delivery\nSame city 50 INR, free above 2000 INR. Courier 2-3 days outside city.\n\n## Location\nShop 12, Central Market. Search on Maps: Central Retail.",
    },
  },
  restaurant: {
    greeting: "Hello! Thanks for calling. How can I help with your reservation or order?",
    voice_script: voicePrompt(
      "the host for the restaurant",
      "Help with: table bookings, menu, timings, location, and takeaway orders. Ask for name, guests, date/time for bookings; dish and quantity for orders."
    ),
    chat_script: chatPrompt(
      "the host for the restaurant",
      "Help with: menu, bookings, timings, location, and orders. Collect name, guests, and slot for reservations."
    ),
    sampleDoc: {
      filename: "Restaurant-FAQ.md",
      content: "# Restaurant — Menu and Booking\n\n## Timings\n12pm-3:30pm lunch, 7pm-11pm dinner. Tuesday closed.\n\n## Booking\nCall with name, guests, date, time. Hold 15 mins.\n\n## Popular Dishes\n- Paneer Tikka 320 INR, Dal Makhani 280 INR, Butter Naan 60 INR, Biryani 350 INR\n\n## Location\n12 Park Street, near City Square Mall.",
    },
  },
};

export function templateForCategory(categoryId: string): AgentTemplate | null {
  if (!categoryId) return null;
  const key = categoryId.toLowerCase().replace(/\s+/g, "_");
  return AGENT_TEMPLATES[key] ?? null;
}

export function defaultTemplate(businessName: string): AgentTemplate {
  return {
    greeting: businessName ? `Hello! Thanks for calling ${businessName}. How can I help you today?` : "Hello! Thanks for calling. How can I help you today?",
    voice_script: voicePrompt(
      businessName ? `${businessName}` : "the business",
      "Help with: services, timings, location, pricing, and bookings. Be concise and helpful; offer to take a message when unsure."
    ),
    chat_script: chatPrompt(
      businessName ? `${businessName}` : "the business",
      "Help with: services, timings, location, pricing, and bookings. Cite your documents when you can."
    ),
    sampleDoc: {
      filename: "Business-FAQ.md",
      content: `# ${businessName || "Business"} — FAQ\n\n## Services\nWe offer core services described by the owner. Ask us for details.\n\n## Timings\nContact us for current hours.\n\n## Location\nReach us via the shared link.\n\n## Booking\nShare name, phone, and preferred time.`,
    },
  };
}

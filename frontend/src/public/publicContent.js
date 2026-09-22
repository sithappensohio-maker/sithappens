/* Editorial copy for the public website, carried over from
 * sithappensohiodogtraining.com and tightened. Business facts (phone, email,
 * address, hours) are NOT here — they come from /public/site. Programs and
 * services come from the app's own catalog; the fallbacks below only render
 * when the catalog is empty so the page never looks broken. */

export const PROBLEMS = ["Leash pulling", "Jumping", "Barking", "Not listening", "Puppy chaos", "Poor recall"];

export const PROMISE = {
  eyebrow: "Better behavior. Happier life.",
  consult_title: "Your dog's path to success starts with a free Meet & Greet.",
  consult_body: "Every training package starts with a free in-person Meet & Greet. We assess your dog's behavior, discuss your goals, and create a personalized path forward.",
  consult_points: ["No pressure. Just solutions.", "Personalized training plan.", "Local trainers who care."],
};

export const PILLARS = [
  { icon: "fa-scale-balanced", color: "#8cc63f", title: "Balanced training", body: "Clear communication: we reward the behaviors we want and use fair, appropriate corrections for unwanted ones, so dogs understand expectations." },
  { icon: "fa-house-chimney", color: "#00a9e0", title: "Real-world results", body: "Skills are practiced where life happens: at home, on walks, in parks and stores. Not just in a training room." },
  { icon: "fa-mobile-screen", color: "#f26522", title: "Everything in your pocket", body: "Book, see report cards and photos, track homework, and message us from one portal on your phone." },
  { icon: "fa-handshake", color: "#a855f7", title: "Support that lasts", body: "Follow-up guidance from our trainers after every program, so progress sticks for the long haul." },
];

export const HOW_TO_BOOK = [
  { n: 1, title: "Tell us about your dog", body: "Two minutes, no account. Or request a free Meet & Greet straight from this page." },
  { n: 2, title: "Free Meet & Greet", body: "We meet your dog, talk through goals, and recommend a plan. No pressure." },
  { n: 3, title: "Book from your portal", body: "Daycare, boarding, lessons and photo sessions, all from your phone, with report cards after every visit." },
];

export const FALLBACK_PROGRAMS = [
  { id: "f-puppy", name: "Puppy Training", type: "private_lessons", type_label: "Private lessons", description: "Build strong foundations with socialization, confidence, manners, and essential life skills for a well-rounded puppy." },
  { id: "f-basic", name: "Basic Obedience Training", type: "private_lessons", type_label: "Private lessons", description: "Teach clear communication and reliable everyday commands to improve behavior at home and in public." },
  { id: "f-behavior", name: "Behavior Modification", type: "private_lessons", type_label: "Private lessons", description: "Address problem behaviors with a personalized plan designed to create lasting change and better control." },
  { id: "f-service", name: "Service Dog Level Training", type: "service_dog", type_label: "Service dog training", description: "Develop advanced obedience, public access skills, and task-focused training for dependable real-world performance." },
];

export const BOARD_TRAIN_INCLUDED = [
  { icon: "fa-clock", title: "Immersive 24/7 learning", body: "Training doesn't stop after a session. Your dog practices better choices all day in a structured environment." },
  { icon: "fa-clipboard-list", title: "Customized training plan", body: "A balanced approach tailored to your dog's temperament, goals, and your lifestyle." },
  { icon: "fa-person-running", title: "Daily enrichment", body: "Plenty of exercise, engagement, and supervised socialization with our daycare pack." },
  { icon: "fa-people-arrows", title: "Transfer session", body: "A 90-minute one-on-one pickup session shows you exactly how to maintain your dog's new skills at home." },
  { icon: "fa-handshake-angle", title: "Lifetime support", body: "Follow-up guidance from our trainers so the progress sticks for the long haul." },
];

export const FAQ = [
  { q: "Where will my dog be staying?", a: "Your dog stays at our professional facility in Warren, Ohio. The center is climate-controlled, safe, monitored, and designed to provide a clean, structured environment where dogs can feel secure and focused." },
  { q: "What is balanced training?", a: "Balanced training means clear communication. We reward the behaviors we want and use fair, appropriate corrections for unwanted behaviors, helping dogs clearly understand expectations." },
  { q: "Can I visit my dog during their stay?", a: "Yes, visits are available by appointment only. We schedule them carefully so they do not interrupt your dog's progress or create unnecessary stress during training." },
  { q: "What do I need to bring for my dog's stay?", a: "Please bring enough of your dog's regular food for the full stay, any required medications, and a copy of current vaccination records. We provide training tools, bedding, and bowls." },
  { q: "Is my dog too old or too young for Board & Train?", a: "We accept puppies starting at 16 weeks once vaccinations are complete. Older dogs are welcome too, as long as they are healthy and able to participate comfortably." },
  { q: "Will the training stick once my dog comes home?", a: "Every program includes a detailed go-home session so you know how to maintain the training. When you follow the structure we provide, your dog can continue progressing at home." },
];

export const ABOUT = {
  headline: "Balanced training. Real-world results.",
  body: "Based in Warren, Ohio, we help dogs and their owners build better behavior, clearer communication, and stronger relationships through balanced training and personalized plans. Unlike standard boarding, our Board & Train guests are treated like family: a safe, clean, professional environment where clear communication turns into real-world results.",
  quote: "We don't just train dogs; we build better relationships between dogs and their owners.",
};

export const PHOTOGRAPHY = {
  eyebrow: "Custom canine portraits",
  points: ["Outdoor sessions", "Polished portraits", "Action shots", "Personality photos"],
  body: "We believe every dog has a unique story to tell. Our pet photography sessions capture the moments that matter most, turning them into lasting memories you'll cherish for years to come. Let us help you preserve your beloved dog's personality, spirit, and story.",
};

export const CATEGORY_META = {
  training: { label: "Training", icon: "fa-graduation-cap", color: "#a855f7", blurb: "Private lessons, Board & Train, and a personalized plan for your dog." },
  daycare: { label: "Daycare", icon: "fa-sun", color: "#00a9e0", blurb: "Structured play, calm naps, and a tired, happy pup at pickup." },
  boarding: { label: "Boarding", icon: "fa-moon", color: "#8cc63f", blurb: "Overnight stays with supervised daycare play built in." },
  online_school: { label: "Online School", icon: "fa-laptop-file", color: "#00a9e0", blurb: "Step-by-step Sit Happens lessons from home, with a free starter course." },
  photography: { label: "Photography", icon: "fa-camera-retro", color: "#f97316", blurb: "Custom canine portraits and action shots that capture your dog's personality." },
};

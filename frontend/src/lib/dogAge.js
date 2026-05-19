// Compute a dog's age live from its birthday so the UI stays accurate
// without us having to write age values into the database every day.
// If `birthday` is missing/blank, falls back to whatever `age_y` / `age_m`
// the dog was originally created with so older records keep working.

function ageFromBirthday(birthday) {
  if (!birthday) return null;
  // birthday is stored as ISO "YYYY-MM-DD"
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(birthday));
  if (!m) return null;
  const by = +m[1], bm = +m[2], bd = +m[3];
  const now = new Date();
  let years = now.getFullYear() - by;
  let months = (now.getMonth() + 1) - bm;
  let days = now.getDate() - bd;
  if (days < 0) months -= 1;
  if (months < 0) { years -= 1; months += 12; }
  if (years < 0) return null; // future birthday → ignore
  return { years, months };
}

export function dogAge(dog) {
  if (!dog) return { years: 0, months: 0, fromBirthday: false };
  const fromBd = ageFromBirthday(dog.birthday);
  if (fromBd) return { ...fromBd, fromBirthday: true };
  return {
    years: parseInt(dog.age_y) || 0,
    months: parseInt(dog.age_m) || 0,
    fromBirthday: false,
  };
}

export function dogAgeMonths(dog) {
  const a = dogAge(dog);
  return a.years * 12 + a.months;
}

export function dogAgeLabel(dog) {
  const a = dogAge(dog);
  return `${a.years}y ${a.months}m`;
}

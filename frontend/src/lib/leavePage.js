// Send the browser to another site (the Stripe card page). Its own tiny
// module so a mounted test can watch for it instead of really navigating.
export function leaveTo(url) {
  window.location.href = url;
}

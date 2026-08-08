/* Unified operational toolbar — search, filters and primary actions live on
 * one quiet raised surface and collapse cleanly on phones. */
export default function AdminToolbar({ children, className = "", testid }) {
  return (
    <div className={`sh-admin-toolbar ${className}`} data-testid={testid}>
      {children}
    </div>
  );
}

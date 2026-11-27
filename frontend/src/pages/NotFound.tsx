import { Link } from "react-router-dom";

export function NotFound() {
  return (
    <section className="card empty-state">
      <h1>Page not found</h1>
      <p>This route is not part of the workspace.</p>
      <Link to="/" className="button primary">
        Back to dashboard
      </Link>
    </section>
  );
}

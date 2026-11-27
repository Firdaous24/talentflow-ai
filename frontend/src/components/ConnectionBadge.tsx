import { useSession } from "../session";

export function ConnectionBadge() {
  const { connection } = useSession();
  return (
    <span className={`connection ${connection}`} role="status">
      <i />
      {connection === "online"
        ? "Backend connected"
        : connection === "offline"
          ? "Backend unavailable"
          : "Checking backend"}
    </span>
  );
}

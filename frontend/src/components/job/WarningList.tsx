export function WarningList({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null;
  return (
    <details className="job-source">
      <summary>Analysis notes ({warnings.length})</summary>
      <ul className="job-warning-list">
        {warnings.map((warning, index) => (
          <li key={index}>{warning}</li>
        ))}
      </ul>
    </details>
  );
}


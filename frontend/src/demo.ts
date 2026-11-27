/**
 * Demo mode: a fictional CV and job post generated in the browser.
 * The person and organisations are invented and the e-mail uses example.com.
 * Nothing is stored; the profile still goes through the normal human review.
 */

export const DEMO_FILENAME = "fictional-demo-cv.pdf";

const DEMO_CV: { text: string; heading?: boolean; gap?: boolean }[] = [
  { text: "Juno Fictional", heading: true },
  { text: "Email: juno.fictional@example.com" },
  { text: "Phone: +1 202 555 0147" },
  { text: "Professional Experience", heading: true, gap: true },
  { text: "Data Analyst | Fictional Orchard Labs" },
  { text: "2022 - 2024" },
  { text: "- Built SQL dashboards using Python for a fictional retail team." },
  { text: "- Gathered business requirements from fictional stakeholders." },
  { text: "Education", heading: true, gap: true },
  { text: "Master in Data Science | Fictional University" },
  { text: "2020 - 2022" },
  { text: "Academic Projects", heading: true, gap: true },
  { text: "Orchestration demonstration" },
  { text: "- Created an Apache Airflow pipeline for a fictional data project." },
  { text: "Technical Skills", heading: true, gap: true },
  { text: "SQL, Python, Docker" },
];

export const DEMO_JOB = `Fictional Data Analyst
Required skills
- Python and SQL are required.
- A Master's degree in Data Science is required.
- Minimum 2 years of experience in data analysis.
Preferred qualifications
- Experience with Apache Airflow is a plus.
- Power BI is a plus.
Technical environment
GCP / Docker`;

function escapePdfText(value: string) {
  return value.replace(/[\\()]/g, (character) => `\\${character}`);
}

/** Build a small, structurally valid single-page PDF (Helvetica, ASCII text, exact xref offsets). */
export function buildDemoCvPdf(): Uint8Array {
  let y = 790;
  const content: string[] = [];
  for (const line of DEMO_CV) {
    if (line.gap) y -= 10;
    const size = line.heading ? 13 : 11;
    content.push(`BT /${line.heading ? "F2" : "F1"} ${size} Tf 56 ${y} Td (${escapePdfText(line.text)}) Tj ET`);
    y -= line.heading ? 20 : 16;
  }
  const stream = content.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // ASCII only, so string offsets equal byte offsets.
  return new TextEncoder().encode(pdf);
}

export function buildDemoCvFile(): File {
  const bytes = buildDemoCvPdf();
  return new File([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], DEMO_FILENAME, { type: "application/pdf" });
}

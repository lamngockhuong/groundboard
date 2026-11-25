// Synthetic fixture for screen states. Frozen: edit only together with the boards.
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { executeImport, validateFile } from "../api";

type Step = "upload" | "validating" | "confirm" | "errors" | "executing" | "complete";

export function UserUpload() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("upload");
  const [mismatch, setMismatch] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [controller, setController] = useState<AbortController | null>(null);

  async function onFileChosen(file: File) {
    const abort = new AbortController();
    setController(abort);
    setStep("validating");
    const response = await validateFile(file, abort.signal);
    if (response.kind === "ok") setStep("confirm");
    else if (response.kind === "row-errors") setStep("errors");
    else if (response.kind === "template-mismatch") {
      setMismatch(true);
      setStep("upload");
    } else setStep("upload");
  }

  function onCancelValidation() {
    controller?.abort();
    setStep("upload");
  }

  async function onExecute() {
    setDialogOpen(false);
    setStep("executing");
    setResult(await executeImport());
    setStep("complete");
  }

  const header = (
    <nav>
      <Link to="/admin/users">Users</Link> / Bulk upload
    </nav>
  );

  switch (step) {
    case "upload":
      return (
        <main>
          {header}
          <h1>Bulk upload users</h1>
          <a href="/templates/users.csv" download>
            Download template
          </a>
          {mismatch ? (
            <section role="alert">
              <p>The file does not match the user template.</p>
              <button type="button" onClick={() => setMismatch(false)}>
                Upload again
              </button>
            </section>
          ) : (
            <FileDrop onFile={onFileChosen} label="Drop a CSV file or choose one" />
          )}
        </main>
      );
    case "validating":
      return (
        <main>
          <p>Checking the file…</p>
          <button type="button" onClick={onCancelValidation}>
            Cancel
          </button>
        </main>
      );
    case "confirm":
      return (
        <main>
          <h2>Ready to import</h2>
          <RowSummary />
          <button type="button" onClick={() => setStep("upload")}>
            Cancel
          </button>
          <button type="button" onClick={() => setDialogOpen(true)}>
            Import
          </button>
          {dialogOpen && (
            <dialog open>
              <p>Import these users now?</p>
              <button type="button" onClick={() => setDialogOpen(false)}>
                Cancel
              </button>
              <button type="button" onClick={onExecute}>
                Import
              </button>
            </dialog>
          )}
        </main>
      );
    case "errors":
      return (
        <main>
          <h2>Some rows have errors</h2>
          <RowErrors />
          <button type="button" onClick={() => setStep("upload")}>
            Upload again
          </button>
        </main>
      );
    case "executing":
      return (
        <main>
          <p>Importing users…</p>
        </main>
      );
    case "complete":
      return (
        <main>
          <h2>Import finished</h2>
          <ResultSummary result={result} />
          <button type="button" onClick={() => navigate("/admin/users")}>
            Back to users
          </button>
        </main>
      );
  }
}

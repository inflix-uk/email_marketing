"use client";

import { Button } from "@/components/ui/button";

/** Opens the browser's print dialog (choose "Save as PDF" there). See the print styles in globals.css. */
export function PrintButton() {
  return (
    <Button type="button" variant="secondary" onClick={() => window.print()} title="Print this report or save it as a PDF">
      Print / PDF
    </Button>
  );
}

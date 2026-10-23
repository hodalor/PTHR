const waitForImages = (doc) =>
  Promise.all(
    Array.from(doc.images || []).map((image) => {
      if (image.complete) {
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        image.onload = resolve;
        image.onerror = resolve;
      });
    })
  );

const collectStyles = () =>
  Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
    .map((node) => node.outerHTML)
    .join('\n');

export const printPayslipDocument = async (sourceEl) => {
  if (!sourceEl) {
    throw new Error('Payslip is not ready to print.');
  }

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('title', 'Payslip print');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc || !win) {
    iframe.remove();
    throw new Error('Unable to open print preview.');
  }

  doc.open();
  doc.write(`<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Payslip</title>
    ${collectStyles()}
    <style>
      html, body {
        margin: 0;
        padding: 0;
        background: #fff !important;
        height: auto !important;
        overflow: visible !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
        color-adjust: exact !important;
      }
      body {
        padding: 8mm 10mm;
      }
      .payslip-document {
        max-width: none !important;
        width: 100% !important;
        margin: 0 !important;
        box-shadow: none !important;
        border-radius: 0 !important;
      }
      @page {
        size: A4 portrait;
        margin: 8mm 10mm;
      }
      @media print {
        html, body {
          padding: 0 !important;
        }
        * {
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
          color-adjust: exact !important;
        }
      }
    </style>
  </head>
  <body></body>
</html>`);
  doc.close();

  const clone = sourceEl.cloneNode(true);
  doc.body.appendChild(clone);
  await waitForImages(doc);
  await new Promise((resolve) => setTimeout(resolve, 160));

  const cleanup = () => {
    window.setTimeout(() => iframe.remove(), 400);
  };
  win.addEventListener('afterprint', cleanup, { once: true });
  win.focus();
  win.print();
  window.setTimeout(cleanup, 2000);
};

/** Vite gives a file imported with ?url as its address (pdf.js's worker). */
declare module '*?url' {
  const url: string;
  export default url;
}

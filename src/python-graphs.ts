/** Return the temporary script filename used for a runtime execution. */
export function executionScriptName(lang: string, extension: string): string {
  // `code.py` shadows Python's standard-library `code` module. Plotly's
  // optional IPython import reaches it through pdb and would re-enter the
  // user's script while Plotly is only partially imported.
  return lang === "python" ? "ocode-exec.py" : `code${extension}`;
}

/** Parse an internal figure marker from one buffered stdout line. */
export function parseFigureSentinel(line: string): number | null {
  // Python uses CRLF on Windows, leaving `\r` after splitting on `\n`.
  const match = /^OCODE_FIG_(\d+)\r?$/.exec(line);
  return match ? Number.parseInt(match[1], 10) : null;
}

/**
 * Wrap Python code to save Matplotlib and Plotly figures to temporary files.
 */
export function wrapPythonForGraphs(
  code: string,
  imgDir: string,
  interactivePlots: boolean,
  embedPlotlyJs: boolean,
  matplotlibStyle: string,
): string {
  const styleLines = matplotlibStyle
    ? `    try:\n        __plt.style.use(${JSON.stringify(matplotlibStyle)})\n    except Exception:\n        pass\n`
    : "";
  const preamble = `
import sys as __sys
import os as __os
__ocode_img_dir = ${JSON.stringify(imgDir)}
__os.makedirs(__ocode_img_dir, exist_ok=True)
__ocode_img_counter = [0]
__ocode_plotly_interactive = ${interactivePlots ? "True" : "False"}
__ocode_plotly_embed = ${embedPlotlyJs ? "True" : "False"}

# Patch matplotlib
try:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as __plt
${styleLines}    __orig_show = __plt.show
    def __patched_show(*a, **kw):
        __ocode_img_counter[0] += 1
        __idx = __ocode_img_counter[0]
        __fname = __os.path.join(__ocode_img_dir, f"fig_{__idx}.png")
        __plt.savefig(__fname, dpi=150, bbox_inches='tight')
        __plt.close('all')
        print(f"OCODE_FIG_{__idx}", flush=True)
    __plt.show = __patched_show
except ImportError:
    pass

# Patch plotly — capture as interactive HTML (preserves zoom/pan/hover) or
# fall back to a static PNG when interactive plots are disabled.
def __ocode_save_plotly(fig):
    __ocode_img_counter[0] += 1
    __idx = __ocode_img_counter[0]
    if __ocode_plotly_interactive:
        __fname = __os.path.join(__ocode_img_dir, f"fig_{__idx}.html")
        import plotly.io as __pio_w
        __jsmode = True if __ocode_plotly_embed else 'cdn'
        __pio_w.write_html(fig, __fname, include_plotlyjs=__jsmode, full_html=True, config={'responsive': True})
    else:
        __fname = __os.path.join(__ocode_img_dir, f"fig_{__idx}.png")
        fig.write_image(__fname, width=800, height=500)
    print(f"OCODE_FIG_{__idx}", flush=True)
try:
    import plotly.io as __pio
    __orig_pio_show = __pio.show
    def __patched_pio_show(fig, *a, **kw):
        __ocode_save_plotly(fig)
    __pio.show = __patched_pio_show
    import plotly.graph_objects as __pgo
    __orig_pgo_show = __pgo.Figure.show
    def __patched_pgo_show(self, *a, **kw):
        __ocode_save_plotly(self)
    __pgo.Figure.show = __patched_pgo_show
except ImportError:
    pass

try:
    import plotly.express as __px
    __orig_px_show = None
    # plotly express figures are go.Figure instances, already patched above
except ImportError:
    pass

`;
  return preamble + code;
}

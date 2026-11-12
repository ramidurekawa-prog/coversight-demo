'use client';

import * as React from 'react';
import { Icon, Tabs } from '../../kit';
import { CV_PAGES } from '../../../lib/pages';
import { Pill, Callout, PageHead } from '../core';
import { CV_GAPS, CV_WAVES, CV_PAGE_DEPS, CV_GRADE_TONE } from '../extra';

/* ================================================================ What's missing (build view) */
function CvBuild({ focus, onOpen }) {
  const [grade, setGrade] = React.useState("all");
  const deps = focus ? CV_PAGE_DEPS[focus] || [] : null;
  const gaps = CV_GAPS.filter((g) => (grade === "all" || g.grade === grade) && (!deps || deps.includes(g.n)));
  const screensFor = (n) => Object.entries(CV_PAGE_DEPS).filter(([, d]) => d.includes(n)).map(([p]) => p);
  const counts = ["A", "B", "C", "D"].map((g) => [g, CV_GAPS.filter((x) => x.grade === g).length]);
  return (
    <div className="scroll" style={{ height: "100%", overflowY: "auto" }}>
      <div className="cv-page wide">
        <PageHead over="Build plan" q="What has to be built before the finished screens are real?"
          sub="The finished product is the front of the house. These are the platform gaps behind it, graded by what they block, in the order to build them. Every screen lists the gaps it depends on." />
        {deps && (
          <Callout tone="info" icon="Filter">
            <span>Showing the {deps.length === 1 ? "one gap" : `${deps.length} gaps`} behind <b>{CV_PAGES[focus].title}</b>. <button className="cv-link" onClick={() => onOpen(null)}>Show all gaps</button></span>
          </Callout>
        )}
        <div className="cv-grid g4">
          {counts.map(([g, n]) => (
            <div key={g} className="cv-card" style={{ gap: 6 }}>
              <div className="cv-row" style={{ justifyContent: "space-between" }}><Pill tone={CV_GRADE_TONE[g]} icon="Flag">Grade {g}</Pill><span className="cv-fig md">{n}</span></div>
              <span className="cv-xs cv-faint">{{ A: "Blocks the core promise. Do now.", B: "Needed before paying pilots.", C: "Needed to scale.", D: "Later." }[g]}</span>
            </div>
          ))}
        </div>
        <section className="cv-card flush">
          <div className="cv-row" style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", justifyContent: "space-between" }}>
            <span className="cv-h4">Platform gaps</span>
            <Tabs value={grade} onChange={setGrade} tabs={[{ value: "all", label: "All" }, { value: "A", label: "A" }, { value: "B", label: "B" }, { value: "C", label: "C" }, { value: "D", label: "D" }]} />
          </div>
          <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Scrollable table">
            <table className="cv-table">
              <thead><tr><th>#</th><th>Gap</th><th>Today</th><th>Value at stake</th><th>Effort</th><th>Grade</th><th>Wave</th><th>Screens it unblocks</th></tr></thead>
              <tbody>
                {gaps.map((g) => (
                  <tr key={g.n}>
                    <td className="n">{g.n}</td>
                    <td style={{ fontWeight: 600, minWidth: 220 }}>{g.title}</td>
                    <td className="cv-small cv-muted" style={{ minWidth: 200 }}><div className="cv-col" style={{ gap: 6 }}><span>{g.state}</span>{g.pilot && <span className="cv-row nowrap" style={{ gap: 6, alignItems: "flex-start", color: "var(--fg-1)" }}><Pill tone="good" icon="PlugZap">Live in pilot</Pill></span>}{g.pilot && <span className="cv-xs" style={{ color: "var(--fg-2)" }}>{g.pilot}</span>}</div></td>
                    <td className="cv-small" style={{ minWidth: 170 }}>{g.value}</td>
                    <td className="n">{g.effort}</td>
                    <td><Pill tone={CV_GRADE_TONE[g.grade]} icon="Flag">{g.grade}</Pill></td>
                    <td className="n">{g.wave}</td>
                    <td style={{ minWidth: 180 }}>
                      <div className="cv-row" style={{ gap: 4 }}>
                        {screensFor(g.n).map((p) => <button key={p} className="cv-link" style={{ fontSize: "var(--text-xs)" }} onClick={() => onOpen(p, true)}>{CV_PAGES[p].title}</button>)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="cv-card flush">
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}><span className="cv-h4">Build waves</span></div>
          <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Scrollable table">
            <table className="cv-table">
              <thead><tr><th>Wave</th><th>Weeks</th><th>Gaps</th><th>Owner</th><th>Done when</th></tr></thead>
              <tbody>
                {CV_WAVES.map((w) => (
                  <tr key={w.w}>
                    <td style={{ fontWeight: 600, minWidth: 180 }}>{w.w} · {w.name}</td>
                    <td className="n">{w.weeks}</td>
                    <td className="n">{CV_GAPS.filter((g) => g.wave === w.w).map((g) => g.n).join(", ") || (w.w === 2 ? "screens" : "—")}</td>
                    <td className="cv-small">{w.owner}</td>
                    <td className="cv-small cv-muted" style={{ minWidth: 260 }}>{w.done}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="cv-card flush">
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}><span className="cv-h4">Screens and what they wait on</span></div>
          <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Scrollable table">
            <table className="cv-table">
              <thead><tr><th>Screen</th><th>Gaps</th><th>Worst grade</th><th><span className="sr-only">Open</span></th></tr></thead>
              <tbody>
                {Object.entries(CV_PAGE_DEPS).map(([p, d]) => {
                  const worst = ["A", "B", "C", "D"].find((g) => d.some((n) => CV_GAPS[n - 1].grade === g));
                  return (
                    <tr key={p}>
                      <td style={{ fontWeight: 600 }}>{CV_PAGES[p].title}{CV_PAGES[p].added && <span className="cv-xs" style={{ marginLeft: 8, color: "var(--teal-700)", fontWeight: 700 }}>ADDED IN {CV_PAGES[p].added === true ? "V2" : CV_PAGES[p].added}</span>}</td>
                      <td className="n">{d.join(", ")}</td>
                      <td><Pill tone={CV_GRADE_TONE[worst]} icon="Flag">{worst}</Pill></td>
                      <td className="r"><button className="cv-link" onClick={() => onOpen(p, true)}>Open screen <Icon name="ArrowRight" size={14} /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

export { CvBuild };

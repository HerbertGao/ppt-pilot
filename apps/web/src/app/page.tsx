import * as sharedSchema from "@ppt-pilot/shared-schema";
import { SCENES } from "@ppt-pilot/shared-schema";

const exportedNames = Object.keys(sharedSchema).sort();

export default function HomePage() {
  const visibleScenes =
    SCENES.length > 0 ? [...SCENES] : ["等待 shared-schema 导出 SCENES"];
  const visibleExports =
    exportedNames.length > 0 ? exportedNames : ["workspace package pending"];

  return (
    <main className="shell">
      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">Phase 1 Web Shell</p>
        <h1 id="page-title">PPTPilot</h1>
        <p className="lede">
          AI Presentation IDE for controllable PPT creation. This shell only
          proves the Next.js workspace can start and read the shared schema
          package.
        </p>
      </section>

      <section className="contract-card" aria-labelledby="schema-title">
        <div>
          <p className="eyebrow">Shared contract</p>
          <h2 id="schema-title">@ppt-pilot/shared-schema</h2>
        </div>

        <dl className="contract-list">
          <div>
            <dt>Scene values</dt>
            <dd>{visibleScenes.join(" / ")}</dd>
          </div>
          <div>
            <dt>Export sample</dt>
            <dd>{visibleExports.slice(0, 6).join(", ")}</dd>
          </div>
        </dl>
      </section>

      <section className="boundary-card" aria-labelledby="boundary-title">
        <h2 id="boundary-title">Not implemented in this shell</h2>
        <p>
          Requirement Discovery, Spec Review, Canvas, Slide Preview, PPTX
          export, AI generation, and lock-aware regeneration stay out of Phase
          1 Web skeleton scope.
        </p>
      </section>
    </main>
  );
}

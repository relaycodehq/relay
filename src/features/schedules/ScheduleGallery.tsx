// What a new schedule starts from: a blank one, or one of the examples with
// its prompt, its time and where it works already filled in.
import {
  BookOpen,
  Bug,
  Clock,
  FlaskConical,
  GitPullRequest,
  Package,
  Plus,
  ScrollText,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { scheduleWhenLabel } from "../../../shared/schedules";
import { scheduleTemplates, type ScheduleTemplate } from "./schedule-templates";

const icons: Record<ScheduleTemplate["icon"], LucideIcon> = {
  bug: Bug,
  pull: GitPullRequest,
  changelog: ScrollText,
  shield: ShieldCheck,
  tests: FlaskConical,
  deps: Package,
  docs: BookOpen,
};

export function ScheduleGallery({
  onPick,
}: {
  /** Nothing for a blank one. */
  onPick: (template?: ScheduleTemplate) => void;
}) {
  return (
    <section className="schedule-gallery" aria-label="New schedule">
      <div className="schedule-cards">
        <button type="button" className="schedule-card" data-blank onClick={() => onPick()}>
          <span className="schedule-card-icon">
            <Plus size={16} />
          </span>
          <strong>Start from scratch</strong>
          <span className="schedule-card-blurb">Write your own prompt and pick when it runs.</span>
        </button>
        {scheduleTemplates.map((t) => {
          const Icon = icons[t.icon];
          return (
            <button key={t.id} type="button" className="schedule-card" onClick={() => onPick(t)}>
              <span className="schedule-card-icon">
                <Icon size={16} />
              </span>
              <strong>{t.name}</strong>
              <span className="schedule-card-blurb">{t.blurb}</span>
              <small className="schedule-card-when">
                <Clock size={12} />
                {scheduleWhenLabel(t)}
                {t.runtimeMode === "read-only" && <> · Read only</>}
              </small>
            </button>
          );
        })}
      </div>
      <p className="schedule-gallery-hint">
        Or ask an agent in any thread, like “every Friday at 9, draft the changelog”.
      </p>
    </section>
  );
}

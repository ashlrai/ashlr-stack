/** One suggested action, shared by terminal output and versioned JSON. */
export interface NextStep {
  summary: string;
  /** A command to run explicitly; null means no command is needed. */
  command: string | null;
}

export const INIT_STEP: NextStep = { summary: "Set up this project.", command: "stack init" };
export const INSTALL_STEP: NextStep = {
  summary: "Install Phantom for secret storage.",
  command: "brew install ashlrai/phantom/phantom",
};
export const PROVIDERS_STEP: NextStep = {
  summary: "Choose a service to add.",
  command: "stack providers",
};

export function formatNextStep(step: NextStep): string {
  return `Next step: ${step.summary}${step.command ? ` Run \`${step.command}\`.` : ""}`;
}

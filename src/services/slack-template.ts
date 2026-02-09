type TemplateValue = string | number | boolean;

type TemplateContext = Record<string, TemplateValue>;

export type SlackBlock = Record<string, any>; // Slack Block Kit JSON

export class SlackTemplate {
  private template: SlackBlock[];

  constructor(template: SlackBlock[]) {
    this.template = template;
  }

  public render(context: TemplateContext): SlackBlock[] {
    return this.template.map(block => this.replaceInBlock(block, context));
  }

  private replaceInBlock(block: any, context: TemplateContext): any {
    if (Array.isArray(block)) {
      return block.map(b => this.replaceInBlock(b, context));
    } else if (typeof block === "object" && block !== null) {
      const result: any = {};
      for (const [key, value] of Object.entries(block)) {
        result[key] = this.replaceInBlock(value, context);
      }
      return result;
    } else if (typeof block === "string") {
      return block.replace(/\{\{(\w+)\}\}/g, (_, key) => {
        if (key in context) return String(context[key]);
        return "";
      });
    } else {
      return block;
    }
  }
}

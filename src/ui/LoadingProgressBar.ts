/**
 * Interface for a loading task
 */
interface LoadingTask {
  id: number;
  name: string;
  progress: number;
}

export class LoadingProgressBar {
  private idGen: number;
  private tasks: LoadingTask[];
  private container: HTMLElement;
  private progressBarContainerOuter: HTMLDivElement;
  private progressBarBox: HTMLDivElement;
  private progressBarBackground: HTMLDivElement;
  private progressBar: HTMLDivElement;

  constructor(container?: HTMLElement) {
    this.idGen = 0;
    this.tasks = [];
    this.container = container || document.body;

    this.progressBarContainerOuter = document.createElement("div");
    this.progressBarContainerOuter.className = "progressBarOuterContainer";
    this.progressBarContainerOuter.style.display = "none";

    this.progressBarBox = document.createElement("div");
    this.progressBarBox.className = "progressBarBox";

    this.progressBarBackground = document.createElement("div");
    this.progressBarBackground.className = "progressBarBackground";

    this.progressBar = document.createElement("div");
    this.progressBar.className = "progressBar";

    this.progressBarBackground.appendChild(this.progressBar);
    this.progressBarBox.appendChild(this.progressBarBackground);
    this.progressBarContainerOuter.appendChild(this.progressBarBox);

    const style = document.createElement("style");
    style.innerHTML = `
            .progressBarOuterContainer {
                width: 100%;
                height: 100%;
                margin: 0;
                top: 0;
                left: 0;
                position: absolute;
                pointer-events: none;
            }

            .progressBarBox {
                z-index:99999;
                padding: 7px 9px 5px 7px;
                background-color: rgba(190, 190, 190, 0.75);
                border: #555555 1px solid;
                border-radius: 15px;
                margin: 0;
                position: absolute;
                bottom: 50px;
                left: 50%;
                transform: translate(-50%, 0);
                width: 180px;
                height: 30px;
                pointer-events: auto;
            }

            .progressBarBackground {
                width: 100%;
                height: 25px;
                border-radius:10px;
                background-color: rgba(128, 128, 128, 0.75);
                border: #444444 1px solid;
                box-shadow: inset 0 0 10px #333333;
            }

            .progressBar {
                height: 25px;
                width: 0px;
                border-radius:10px;
                background-color: rgba(0, 200, 0, 0.75);
                box-shadow: inset 0 0 10px #003300;
            }
        `;
    this.progressBarContainerOuter.appendChild(style);
    this.container.appendChild(this.progressBarContainerOuter);
  }

  /**
   * Show the progress bar
   */
  public show(): void {
    this.progressBarContainerOuter.style.display = "block";
  }

  /**
   * Hide the progress bar
   */
  public hide(): void {
    this.progressBarContainerOuter.style.display = "none";
  }

  /**
   * Set the progress percentage
   * @param progress The progress percentage (0-100)
   */
  public setProgress(progress: number): void {
    this.progressBar.style.width = progress + "%";
  }

  /**
   * Set the container element for the progress bar
   * @param container The container element
   */
  public setContainer(container: HTMLElement | null): void {
    if (
      this.container &&
      this.progressBarContainerOuter.parentElement === this.container
    ) {
      this.container.removeChild(this.progressBarContainerOuter);
    }
    if (container) {
      this.container = container;
      this.container.appendChild(this.progressBarContainerOuter);
      // Get the container's z-index as a number
      const containerZIndex = parseInt(this.container.style.zIndex) || 0;
      this.progressBarContainerOuter.style.zIndex = (
        containerZIndex + 1
      ).toString();
    }
  }
}

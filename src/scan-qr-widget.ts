import type { Widget as IWidget, IChangedTiddlers } from 'tiddlywiki';
import jsQR from 'jsqr-es6';
import type { Point } from 'jsqr-es6/dist/locator';

const Widget = (require('$:/core/modules/widgets/widget.js') as { widget: typeof IWidget }).widget;

class ScanQRWidget extends Widget {
  // constructor(parseTreeNode: any, options: any) {
  //   super(parseTreeNode, options);
  // }

  refresh(_changedTiddlers: IChangedTiddlers) {
    return false;
  }

  /** id to prevent multiple loops */
  loopId = 0;

  /**
   * Lifecycle method: Render this widget into the DOM
   */
  render(parent: Node, _nextSibling: Node) {
    this.parentDomNode = parent;
    this.execute();

    const outputTiddlerTitle = this.getAttribute('outputTiddlerTitle');

    const containerElement = document.createElement('div');
    containerElement.innerHTML = `
    <div>
      <div id="scan-qr-widget-loadingMessage">🎥 Unable to access video stream (please make sure you have a webcam enabled)</div>
      <canvas id="scan-qr-widget-canvas" hidden></canvas>
      <div id="scan-qr-widget-output" hidden>
        <div id="scan-qr-widget-outputMessage">No QR code detected.</div>
        <div hidden><b>Data:</b> <span id="scan-qr-widget-outputData"></span></div>
      </div>
    </div>
    `;
    this.domNodes.push(containerElement);
    this.loopId += 1;
    const loopId = this.loopId;
    // wait till dom created
    requestAnimationFrame(() => this.jsqr(loopId, containerElement, outputTiddlerTitle));
    parent.appendChild(containerElement);
  }

  async jsqr(loopId: number, containerElement: HTMLDivElement, outputTiddlerTitle?: string | undefined) {
    let video = document.createElement('video');
    let canvasElement = document.getElementById('scan-qr-widget-canvas') as HTMLCanvasElement | null;
    if (!canvasElement) {
      console.warn('ScanQRWidget: canvasElement is null');
      return;
    }
    let canvas = canvasElement.getContext('2d');
    let loadingMessage = document.getElementById('scan-qr-widget-loadingMessage');
    let outputContainer = document.getElementById('scan-qr-widget-output');
    let outputMessage = document.getElementById('scan-qr-widget-outputMessage');
    let outputData = document.getElementById('scan-qr-widget-outputData');
    if (!canvas || !outputData) {
      console.warn('ScanQRWidget: canvas or outputData is null', { canvas, outputData });
      return;
    }

    // Use facingMode: environment to attemt to get the front camera on phones
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });

    function drawLine(begin: Point, end: Point, color: string | CanvasGradient | CanvasPattern) {
      if (!canvas) {
        return;
      }
      canvas.beginPath();
      canvas.moveTo(begin.x, begin.y);
      canvas.lineTo(end.x, end.y);
      canvas.lineWidth = 4;
      canvas.strokeStyle = color;
      canvas.stroke();
    }

    let lastResult: string | undefined;

    const tick = () => {
      if (!loadingMessage || !canvasElement || !outputContainer || !canvas || !outputMessage || !outputData || !outputData.parentElement) {
        console.warn(
          'ScanQRWidget: !loadingMessage || !canvasElement || !outputContainer || !canvas || !outputMessage || !outputData || !outputData.parentElement, it is null',
          {
            loadingMessage,
            canvasElement,
            outputContainer,
            canvas,
            outputMessage,
            outputData,
            'outputData.parentElement': outputData && outputData.parentElement,
          },
        );

        return;
      }
      loadingMessage.innerText = '⌛ Loading video...';
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        loadingMessage.hidden = true;
        canvasElement.hidden = false;
        outputContainer.hidden = false;

        canvasElement.height = video.videoHeight;
        canvasElement.width = video.videoWidth;
        canvas.drawImage(video, 0, 0, canvasElement.width, canvasElement.height);
        let imageData = canvas.getImageData(0, 0, canvasElement.width, canvasElement.height);
        let code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert',
        });
        outputMessage.hidden = true;
        outputData.parentElement.hidden = false;
        let result;
        if (code) {
          drawLine(code.location.topLeftCorner, code.location.topRightCorner, '#FF3B58');
          drawLine(code.location.topRightCorner, code.location.bottomRightCorner, '#FF3B58');
          drawLine(code.location.bottomRightCorner, code.location.bottomLeftCorner, '#FF3B58');
          drawLine(code.location.bottomLeftCorner, code.location.topLeftCorner, '#FF3B58');
          result = code.data;
        } else {
          result = 'No code detected';
        }

        if (result !== lastResult) {
          outputData.innerText += result + '\n';
          lastResult = result;
          // fast check of ip address
          if (outputTiddlerTitle && result.includes(':')) {
            const textFieldTiddler = $tw.wiki.getTiddler(outputTiddlerTitle);
            const newServerInfoTiddler = {
              title: outputTiddlerTitle,
              text: result,
              ...textFieldTiddler?.fields,
            };
            $tw.wiki.addTiddler(newServerInfoTiddler);
          }
        }
      }
      // if new loop happened, this.loopId will > loopId, stop current loop
      if (this.loopId === loopId && containerElement.offsetParent !== null) {
        requestAnimationFrame(tick);
      } else {
        stream.getTracks().forEach(function (track) {
          track.stop();
        });
      }
    };
    video.srcObject = stream;
    video.setAttribute('playsinline', 'true'); // required to tell iOS safari we don't want fullscreen
    video.play();
    requestAnimationFrame(tick);
  }
}

exports.widget = ScanQRWidget;
exports.ScanQRWidget = ScanQRWidget;

package live.tianyi.vvoice.tv;

/** Hardware wiring only. Verified by separate TV-output and external-speaker tests. */
final class ArrayLayout {
    static String forCapture(String model,int channels,int rate) {
        if ("MiTV-MFTR0".equals(model) && channels==4 && rate==16000)
            return "{\"version\":1,\"microphones\":[0,1],\"references\":[2,3]}";
        return null; // Unverified hardware keeps the shared rendered-reference path.
    }
}

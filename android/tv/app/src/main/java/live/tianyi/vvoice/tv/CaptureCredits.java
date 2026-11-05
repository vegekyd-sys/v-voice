package live.tianyi.vvoice.tv;

/** The existing eight-frame DSP window includes output awaiting the page. */
final class CaptureCredits {
    private long sent,acknowledged;
    private int peak;
    boolean available(){return sent-acknowledged<8;}
    void sent(){if(!available())throw new IllegalStateException("Capture window full");sent++;peak=Math.max(peak,(int)(sent-acknowledged));}
    void acknowledge(long sequence){if(sequence!=acknowledged+1||sequence>sent)throw new IllegalArgumentException("Stale or unordered capture acknowledgement");acknowledged=sequence;}
    int peak(){return peak;}
    void reset(){sent=acknowledged=0;peak=0;}
}

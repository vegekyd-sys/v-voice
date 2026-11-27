package live.tianyi.vvoice.tv;

/** The existing eight-frame DSP window includes output awaiting the page. */
final class CaptureCredits {
    private long sent,acknowledged;
    private int peak;
    int remaining(){return 8-(int)(sent-acknowledged);}
    boolean available(){return remaining()>0;}
    void sent(){if(!available())throw new IllegalStateException("Capture window full");sent++;peak=Math.max(peak,(int)(sent-acknowledged));}
    void acknowledge(long sequence){acknowledge(sequence,1);}
    void acknowledge(long sequence,int count){if(count<=0||count>8||sequence!=acknowledged+count||sequence>sent)throw new IllegalArgumentException("Stale or unordered capture acknowledgement");acknowledged=sequence;}
    int peak(){return peak;}
    void reset(){sent=acknowledged=0;peak=0;}
}

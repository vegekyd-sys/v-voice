package com.versa.vvoice;
import java.io.*;
final class BoundedInput {
    static byte[] read(InputStream input,int limit) throws IOException {
        ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] chunk=new byte[4096];int count;
        while((count=input.read(chunk))!=-1){if(out.size()+count>limit)throw new IOException("Response too large");out.write(chunk,0,count);}
        return out.toByteArray();
    }
}

package com.versa.vvoice;
import org.junit.Test;
import java.io.*;
import static org.junit.Assert.*;
public class BoundedInputTest {
    @Test public void largeResponsesCannotFillMemory() throws Exception {
        assertArrayEquals(new byte[32],BoundedInput.read(new ByteArrayInputStream(new byte[32]),32));
        assertThrows(IOException.class,()->BoundedInput.read(new ByteArrayInputStream(new byte[33]),32));
    }
}

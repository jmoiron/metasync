# metasync

For years I shot with a Canon 6d, which had an integrated GPS. I've upgraded to
a Canon r5 mk II, better in every way except that it has no integrated GPS. This
has led to two issues:

* some photos files have the wrong time in their EXIF data
* most photo files do not have any GPS data

The r5 mk II _can_ sync with a phone and use its GPS to populate its GPS data,
so for days when I remember to sync with the phone, I will have usable GPS data.

Unfortunately, I often go several months without shooting, and without GPS data
to fix the factory default clock settings, my photos end up without any coordinate
data _and_ bad timestamps.

_metasync_ fixes this.

## usage

```bash
$ metasync --target photos/without/metadata/ --ref phone-photos/from/same/period
```

_metasync_ is a local web-based tool that allows you to use a known good set of
images as a kind of GPS tracker. If you have a photo in the ref set that is taken
about the same time as a photo in the target set, you can typically use that to
fix all of the photo timestamps in the target set.

From there, you can use the ref GPS coordinates to fix the target GPS coordinates
using a variety of strategies.

![](/metasync.png)

#ifndef UTIL_H
#define UTIL_H

#define MAX_POINTS 64

struct point {
	int x;
	int y;
};

typedef struct point point_t;

int add(int a, int b);
int sum_point(const point_t *p);

#endif
